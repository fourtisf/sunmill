# SUNMIL — deployment runbook

Target: a Hostinger VPS running both apps under PM2 behind nginx.

---

## 1. Provision

```bash
# Node 20 LTS, PM2, Postgres, Redis, nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql redis-server nginx
sudo npm i -g pm2
```

Create the database and a role that owns it:

```bash
sudo -u postgres psql -c "CREATE ROLE sunmil LOGIN PASSWORD '…';"
sudo -u postgres psql -c "CREATE DATABASE sunmil OWNER sunmil;"
```

Redis needs no special configuration, but it must not be reachable from the
internet — bind it to `127.0.0.1` and set a password if the VPS shares a
network. Nothing in Redis is authoritative, so losing it costs cached market
boards and rate-limit counters, not player state.

---

## 2. Configure

```bash
git clone <repo> /var/www/sunmil && cd /var/www/sunmil
cp .env.example .env
```

Fill in `.env`. The ones that matter in production:

| Variable | Notes |
|---|---|
| `NODE_ENV` | `production` — this also disables the dev login route. |
| `JWT_SECRET` | `openssl rand -hex 48`. Rotating it logs everyone out. |
| `COOKIE_SECURE` | `true`. The session cookie must never cross plain HTTP. |
| `COOKIE_DOMAIN` | The apex domain, so `www` and the API host share the cookie. |
| `CORS_ORIGINS` | Exactly the web origins, comma separated. Not `*`. |
| `TRUST_PROXY` | `loopback` when nginx runs on this box. **Never `true`.** Fastify with `true` trusts every hop in `X-Forwarded-For` and reports the left-most entry, which the client writes — nginx appends rather than replaces, so a caller could name their own address and get a fresh rate-limit bucket per request. Widen this only for a load balancer on another host, and name that host. |
| `DATABASE_URL` | Append `?connection_limit=20&pool_timeout=20` to size the Prisma pool for the box. **Quote the whole value** — scripts source this file, and the first unquoted `&` ends the assignment. |
| `TIME_SCALE` | **20** in production — HANDOFF §2.1. `1` is the prototype's demo pace and makes wheat ripen in nine seconds. Raising it on a live box stretches crops and animals mid-growth (they read live config); queued machine jobs keep the duration they started with. |
| `NEXT_PUBLIC_API_URL` | The public origin, e.g. `https://sunmil.fun` — **not** the internal port. Read from this file by `next.config.mjs` and baked into the client bundle at build time, so changing it needs a rebuild, not a restart. Leave it wrong and every browser calls its own machine. |
| `INVITE_CODE` | The closed-beta gate. Empty means no gate. See §10. |
| `HAY_ONCHAIN_ENABLED` | Leave `false` until emission and sinks are signed off. |
| `TREASURY_PRIVATE_KEY` | Server-side only. Never in the client bundle, never in git. |
| `ADMIN_TOKEN` | Min 24 chars. Second factor for `/api/admin`; unset means those routes do not exist. |

`.env` is gitignored. Keep it `chmod 600` and owned by the deploy user.

---

## 3. Build and migrate

```bash
npm ci                                       # also generates the Prisma client
npm run prisma:deploy --workspace=server     # applies migrations, never resets
npm run build                                # server tsc + next build
```

`npm ci` runs the server's `postinstall`, which generates the Prisma client.
Without it `tsc` cannot see `Prisma.Decimal` or `Prisma.InputJsonValue` and the
build dies in about eight files — the generated client is a build input, not a
runtime detail. Install dev dependencies here: `prisma`, `typescript` and `next`
all live there, and this deploy builds from source.

`prisma migrate deploy` is the production command — it applies pending
migrations and nothing else. Never run `migrate dev` or `migrate reset` against
a live database.

---

## 4. Start

```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup           # then run the command it prints
```

After the first time, `scripts/deploy.sh [branch]` does the whole cycle —
fetch, reset to the branch, `npm ci`, migrate, build, reload, health-check —
and is safe to re-run. It never touches `.env` and never resets the database.

Two processes come up: `sunmil-api` (Fastify, `API_PORT`) and `sunmil-web`
(Next, `WEB_PORT`). Both read the repo-root `.env`.

```bash
pm2 logs sunmil-api
pm2 reload ecosystem.config.js --env production   # zero-downtime restart
```

---

## 5. nginx

Terminate TLS at nginx and proxy both apps. The API and the web app should sit
on the same registrable domain so the session cookie is first-party.

```nginx
server {
  listen 443 ssl http2;
  server_name sunmil.example.com;

  # …certbot ssl_certificate lines…

  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

The API sets `trustProxy`, so it reads the real client IP from
`X-Forwarded-For`. Without those headers, rate limiting sees one client.

---

## 6. Verify a deploy

```bash
curl -s https://sunmil.example.com/api/health
curl -s https://sunmil.example.com/api/config | head -c 200
```

Then, from a machine that can reach a non-production instance:

```bash
node server/scripts/smoke.mjs https://staging.sunmil.example.com
```

The smoke test needs the dev login, so it only runs against staging. Against
production, verify by playing: sign in, plant, wait, harvest, and confirm the
farm survives a reload.

Reconcile the ledger against balances at any time:

```sql
SELECT f.id,
       f.coins - 640 AS farm_delta,
       (SELECT COALESCE(SUM(l."coinsDelta"), 0)
          FROM "Ledger" l WHERE l."userId" = f."userId") AS ledger_delta
FROM "Farm" f;
```

The two columns must match for every farm. They will not if a mutation ever
escaped its transaction — that is the check worth alerting on.

---

## 7. Sizing and scaling

Measured on one small container running everything at once:

- The resolver handles tens of thousands of farms per second per core. It is
  not the constraint.
- `GET /api/farm` served 600 req/s at p95 33 ms with 200 concurrent players,
  and saturated around 970 req/s with no errors under 500.

So the ceiling is database round trips. In order, when it starts to hurt:

1. Raise `connection_limit` and give Postgres more `shared_buffers`.
2. Move Postgres to its own box.
3. Run more `sunmil-api` instances (`instances: 'max'`, `exec_mode: 'cluster'`
   in `ecosystem.config.js`) — the API is stateless; sessions are JWTs and
   Redis is shared.

Every action is one short transaction on a single farm's rows, so farms never
contend with each other and this scales horizontally.

---

## 8. Backups

Player state is entirely in Postgres. Redis holds only caches and rate-limit
counters and can be flushed at any time.

```bash
pg_dump -Fc sunmil > /var/backups/sunmil-$(date +%F).dump
```

Keep the `Ledger` table forever — it is the audit trail, and it is what lets
you reconstruct any balance dispute.

---

## 9. Before enabling on-chain $HAY

> **Blocked, not merely unfinished.** `lib/chain.ts` targets an EVM chain while
> wallet login is on Solana. Enabling the flag today would pay out to 0x
> addresses no player ever signs in with, using an ERC-20 transfer for a token
> that is not the token. It needs rewriting for SPL — Solana RPC, a treasury
> keypair, deposits verified from transaction signatures rather than EVM
> receipts — before any of the checklist below is worth working through. The
> ledger, refund, daily-cap and review-hold logic around it is chain-agnostic
> and stays.


Do not set `HAY_ONCHAIN_ENABLED=true` until all of these hold:

- [ ] ALFA has signed off on the emission schedule and the sinks.
- [ ] The treasury key lives only in the server `.env`, `chmod 600`.
- [ ] The treasury is funded, and its balance is monitored with an alert.
- [ ] `HAY_WITHDRAW_DAILY_CAP` and `HAY_WITHDRAW_REVIEW_THRESHOLD` are set to
      agreed values.
- [ ] `CHAIN_MIN_CONFIRMATIONS` matches Robinhood Chain's finality guidance.
- [ ] Someone owns the `review` queue. The API deducts the game hay and records
      the row but deliberately does not broadcast it; an operator releases or
      rejects it through `/api/admin/withdrawals` (see §10).
- [ ] The flow has been exercised end to end on a testnet.

Off-chain `hay` works with the flag off, so there is no pressure to turn it on
before the economy is settled.

---

## 10. Closed beta

`INVITE_CODE` gates the landing page. It is checked on the server, not in the
browser: `POST /api/invite` compares the posted code and, on a match, sets a
signed httpOnly cookie. Every route that can open a session — the guest login,
the wallet nonce, the wallet login, the dev login — refuses without that cookie.
So deleting the overlay in devtools or calling the API directly gets nobody in.

With `WALLET_LOGIN=false` (the default) the code is the only way in, and the
farm key the API returns on the first `POST /api/auth/guest` is the only way
back to a farm. Support consequence worth knowing before a tester asks: we
store the SHA-256, so a lost key cannot be looked up, reissued or recovered —
the farm is simply unreachable. Point players at the "Restore a farm" link on
the login card and at whatever copy of the key they kept.

```bash
# turn the gate on
INVITE_CODE=some-long-code-here    # then restart sunmil-api

# rotate it — everyone already through keeps their cookie until it expires
INVITE_CODE=a-different-one

# turn it off (public launch)
INVITE_CODE=
```

Unset means **no gate**: anyone can create an account. That is the right state
for local development and CI, and the API says so loudly at boot in production.

Two things worth knowing before you pick a code:

- **Length is the whole defence.** `POST /api/invite` allows 10 attempts per IP
  per 10 minutes, which makes a four-digit code take about a week to exhaust
  from one address — and roughly an hour from a hundred. For a small private
  beta that is fine. Before any public announcement, use something long.
- That limit only means anything while `TRUST_PROXY` is narrow. Set it to
  `true` and the bucket key becomes a header the guesser writes, so the limit
  stops existing — see §2.
- **A code is shared, not per-player.** The first person through can pass it on.
  If you need to know who let whom in, that is a different feature: per-user
  invite rows with a redeemed-by column, not one shared string.

`INVITE_TTL_SECONDS` (default 30 days) is how long a browser stays through the
gate once it has passed.

---

## 11. Operator tools

Withdrawals at or above `HAY_WITHDRAW_REVIEW_THRESHOLD` are held: the player's
game hay is already debited and the transfer row exists, but nothing is
broadcast. A human decides.

Access needs **both** halves, so a stolen session alone cannot move treasury
funds:

1. The user row must have `isAdmin = true`.
2. The request must carry `X-Admin-Token: $ADMIN_TOKEN`.

With `ADMIN_TOKEN` unset the routes 404 — that is the safe default, and the
right state for a deployment with nobody on call.

```bash
# grant an operator (once, deliberately)
psql "$DATABASE_URL" -c "UPDATE \"User\" SET \"isAdmin\" = true WHERE wallet = '0x…';"

# what is waiting
curl -s https://sunmil.example.com/api/admin/withdrawals \
  -H "X-Admin-Token: $ADMIN_TOKEN" -b cookies.txt

# send it
curl -s -X POST https://sunmil.example.com/api/admin/withdrawals/release \
  -H "X-Admin-Token: $ADMIN_TOKEN" -H 'content-type: application/json' -b cookies.txt \
  -d '{"transferId":"…"}'

# refuse it — the player's $HAY goes back, with a Ledger row recording why
curl -s -X POST https://sunmil.example.com/api/admin/withdrawals/reject \
  -H "X-Admin-Token: $ADMIN_TOKEN" -H 'content-type: application/json' -b cookies.txt \
  -d '{"transferId":"…","reason":"failed review"}'
```

A release claims the row before broadcasting, so two operators cannot both send
the same transfer. A failed broadcast puts it back in `review` to retry rather
than losing it.
