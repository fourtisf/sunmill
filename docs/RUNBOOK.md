# SUNMILL — deployment runbook

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
sudo -u postgres psql -c "CREATE ROLE sunmill LOGIN PASSWORD '…';"
sudo -u postgres psql -c "CREATE DATABASE sunmill OWNER sunmill;"
```

Redis needs no special configuration, but it must not be reachable from the
internet — bind it to `127.0.0.1` and set a password if the VPS shares a
network. Nothing in Redis is authoritative, so losing it costs cached market
boards and rate-limit counters, not player state.

---

## 2. Configure

```bash
git clone <repo> /var/www/sunmill && cd /var/www/sunmill
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
| `DATABASE_URL` | Append `?connection_limit=20&pool_timeout=20` to size the Prisma pool for the box. |
| `TIME_SCALE` | See README. **Confirm with ALFA before locking.** |
| `HAY_ONCHAIN_ENABLED` | Leave `false` until emission and sinks are signed off. |
| `TREASURY_PRIVATE_KEY` | Server-side only. Never in the client bundle, never in git. |

`.env` is gitignored. Keep it `chmod 600` and owned by the deploy user.

---

## 3. Build and migrate

```bash
npm ci
npm run prisma:deploy --workspace=server     # applies migrations, never resets
npm run build                                # server tsc + next build
```

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

Two processes come up: `sunmill-api` (Fastify, `API_PORT`) and `sunmill-web`
(Next, `WEB_PORT`). Both read the repo-root `.env`.

```bash
pm2 logs sunmill-api
pm2 reload ecosystem.config.js --env production   # zero-downtime restart
```

---

## 5. nginx

Terminate TLS at nginx and proxy both apps. The API and the web app should sit
on the same registrable domain so the session cookie is first-party.

```nginx
server {
  listen 443 ssl http2;
  server_name sunmill.example.com;

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
curl -s https://sunmill.example.com/api/health
curl -s https://sunmill.example.com/api/config | head -c 200
```

Then, from a machine that can reach a non-production instance:

```bash
node server/scripts/smoke.mjs https://staging.sunmill.example.com
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
3. Run more `sunmill-api` instances (`instances: 'max'`, `exec_mode: 'cluster'`
   in `ecosystem.config.js`) — the API is stateless; sessions are JWTs and
   Redis is shared.

Every action is one short transaction on a single farm's rows, so farms never
contend with each other and this scales horizontally.

---

## 8. Backups

Player state is entirely in Postgres. Redis holds only caches and rate-limit
counters and can be flushed at any time.

```bash
pg_dump -Fc sunmill > /var/backups/sunmill-$(date +%F).dump
```

Keep the `Ledger` table forever — it is the audit trail, and it is what lets
you reconstruct any balance dispute.

---

## 9. Before enabling on-chain $HAY

Do not set `HAY_ONCHAIN_ENABLED=true` until all of these hold:

- [ ] ALFA has signed off on the emission schedule and the sinks.
- [ ] The treasury key lives only in the server `.env`, `chmod 600`.
- [ ] The treasury is funded, and its balance is monitored with an alert.
- [ ] `HAY_WITHDRAW_DAILY_CAP` and `HAY_WITHDRAW_REVIEW_THRESHOLD` are set to
      agreed values.
- [ ] `CHAIN_MIN_CONFIRMATIONS` matches Robinhood Chain's finality guidance.
- [ ] Withdrawals in `review` status have an operator process behind them —
      the API deducts the game hay and records the row, but deliberately does
      not broadcast those.
- [ ] The flow has been exercised end to end on a testnet.

Off-chain `hay` works with the flag off, so there is no pressure to turn it on
before the economy is settled.
