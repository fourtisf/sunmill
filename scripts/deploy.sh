#!/usr/bin/env bash
# Pull, build and reload SUNMIL on the VPS.
#
#   scripts/deploy.sh [branch]
#
# Idempotent — safe to re-run. It never touches .env and never resets the
# database: prisma migrate deploy applies pending migrations and nothing else.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Read values out of .env rather than sourcing it. Sourcing executes the file,
# and a value carrying an unquoted & would run as a background command instead
# of being assigned. Everything else reads .env through dotenv.
envval() { sed -n "s/^$1=//p" .env | tail -1 | tr -d "\"'" ; }

[ -f .env ] || {
  echo "no .env at $ROOT — copy .env.example and fill it in before deploying" >&2
  exit 1
}

API_PORT="$(envval API_PORT)"; API_PORT="${API_PORT:-4000}"
WEB_PORT="$(envval WEB_PORT)"; WEB_PORT="${WEB_PORT:-3000}"

# Fail here rather than half way through a migration. Both of these have to be
# enabled at boot, not just started once — a VPS reboot is what usually takes
# them away, and P1001 in the middle of a deploy is a confusing way to find out.
for svc in postgresql redis-server; do
  systemctl is-enabled --quiet "$svc" 2>/dev/null \
    || echo "warning: $svc is not enabled at boot — run: systemctl enable $svc" >&2
done
# Check the endpoints the apps will actually dial, not the defaults. Bare
# pg_isready probes the Unix socket, which stays up even when the server is not
# listening on TCP at all — so it can pass while Prisma cannot connect, which
# is a false green at exactly the wrong moment.
DB_URL="$(envval DATABASE_URL)"
# Greedy .*@ so it lands on the last @, not the first — a password may contain
# one. Falls back to the credential-less form, then to the defaults.
DB_AUTHORITY="$(printf '%s' "$DB_URL" | sed -n 's#^[a-z]*://\(.*\)$#\1#p')"
DB_AUTHORITY="${DB_AUTHORITY##*@}"
DB_HOST="$(printf '%s' "$DB_AUTHORITY" | sed -n 's#^\([^:/?]*\).*#\1#p')"
DB_PORT="$(printf '%s' "$DB_AUTHORITY" | sed -n 's#^[^:/?]*:\([0-9]*\).*#\1#p')"
DB_HOST="${DB_HOST:-127.0.0.1}"; DB_PORT="${DB_PORT:-5432}"

if command -v pg_isready >/dev/null && ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -q; then
  echo "postgres is not reachable on $DB_HOST:$DB_PORT — which is what DATABASE_URL asks for." >&2
  if pg_isready -q 2>/dev/null; then
    echo "It IS answering on its Unix socket, so the server is running but not" >&2
    echo "listening there. Check which port the cluster uses and whether it" >&2
    echo "listens on TCP at all:" >&2
    echo "  pg_lsclusters" >&2
    echo "  sudo -u postgres psql -tAc 'SHOW port' -tAc 'SHOW listen_addresses'" >&2
    echo "Then either point DATABASE_URL at that port, or set" >&2
    echo "listen_addresses = 'localhost' in postgresql.conf and restart." >&2
  else
    echo "Start it: systemctl start postgresql" >&2
  fi
  exit 1
fi

REDIS_URL_VAL="$(envval REDIS_URL)"
if command -v redis-cli >/dev/null \
  && [ "$(redis-cli -u "${REDIS_URL_VAL:-redis://127.0.0.1:6379}" ping 2>/dev/null)" != PONG ]; then
  echo "redis is not answering on ${REDIS_URL_VAL:-redis://127.0.0.1:6379}" >&2
  echo "Start it: systemctl start redis-server" >&2
  exit 1
fi

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"

echo "==> fetching $BRANCH"
git fetch --prune origin "$BRANCH"
git checkout "$BRANCH"
# A deploy box is a mirror of the branch, not a place to edit. .env is
# gitignored, so this leaves the secrets alone.
git reset --hard "origin/$BRANCH"

echo "==> installing"
npm ci

echo "==> migrating"
npm run prisma:deploy --workspace=server

echo "==> building"
# NEXT_PUBLIC_API_URL is read out of the root .env by next.config.mjs and baked
# into the client bundle here, so a wrong value needs a rebuild, not a restart.
# Next's build cache keys on source, not on that file — so a corrected .env
# with untouched sources could otherwise be served from a stale chunk. A cold
# build costs under a minute and removes the question.
rm -rf frontend/.next
npm run build

echo "==> reloading"
pm2 reload ecosystem.config.js --env production 2>/dev/null \
  || pm2 start ecosystem.config.js --env production
pm2 save

echo "==> checking"
sleep 4
# No -f. A dependency that is down answers 503 WITH the reason in the body,
# and -f throws that body away and exits non-zero — which read as "the api is
# not answering" and sent whoever ran this looking for the wrong problem.
DEEP="$(curl -sS "http://127.0.0.1:${API_PORT}/api/health?deep=1" 2>/dev/null || true)"
case "$DEEP" in
  *'"ok":true'*) echo "    api ok (postgres, redis, and the schema all check out)" ;;
  '') echo "    api is not answering — check: pm2 logs sunmil-api" >&2; exit 1 ;;
  *'"pendingMigrations"'*)
     echo "    the database is BEHIND this build: $DEEP" >&2
     echo "    Every login and every farm write will 500 until the migrations run." >&2
     echo "    Fix: npm run prisma:deploy --workspace=server" >&2
     exit 1 ;;
  *) echo "    api is up but a dependency is not: $DEEP" >&2
     echo "    the first login will 500 until this is fixed." >&2; exit 1 ;;
esac
curl -fsSI "http://127.0.0.1:${WEB_PORT}/" >/dev/null && echo "    web ok"

echo "==> deployed $(git rev-parse --short HEAD) on $BRANCH"
