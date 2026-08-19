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

[ -f .env ] || {
  echo "no .env at $ROOT — copy .env.example and fill it in before deploying" >&2
  exit 1
}

# Read the two ports out of .env rather than sourcing it. Sourcing executes the
# file, and a value carrying an unquoted & would run as a background command
# instead of being assigned. Everything else reads .env through dotenv.
envval() { sed -n "s/^$1=//p" .env | tail -1 | tr -d "\"'" ; }
API_PORT="$(envval API_PORT)"; API_PORT="${API_PORT:-4000}"
WEB_PORT="$(envval WEB_PORT)"; WEB_PORT="${WEB_PORT:-3000}"

# Fail here rather than half way through a migration. Both of these have to be
# enabled at boot, not just started once — a VPS reboot is what usually takes
# them away, and P1001 in the middle of a deploy is a confusing way to find out.
for svc in postgresql redis-server; do
  systemctl is-enabled --quiet "$svc" 2>/dev/null \
    || echo "warning: $svc is not enabled at boot — run: systemctl enable $svc" >&2
done
command -v pg_isready >/dev/null && { pg_isready -q || {
  echo "postgres is not accepting connections — run: systemctl start postgresql" >&2; exit 1; }; }
command -v redis-cli >/dev/null && { [ "$(redis-cli ping 2>/dev/null)" = PONG ] || {
  echo "redis is not answering — run: systemctl start redis-server" >&2; exit 1; }; }

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
curl -fsS "http://127.0.0.1:${API_PORT}/api/health" >/dev/null && echo "    api ok"
curl -fsSI "http://127.0.0.1:${WEB_PORT}/" >/dev/null && echo "    web ok"

echo "==> deployed $(git rev-parse --short HEAD) on $BRANCH"
