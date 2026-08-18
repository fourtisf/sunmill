# SUNMILL

A Hay Day-style production-chain farm game. The client is a procedural canvas
renderer; **everything economic lives on the server**.

`HANDOFF.md` is the product spec. `CLAUDE.md` is the working agreement for this
repo. `prototype/sunmill.html` is the original single-file prototype, kept as
the visual reference.

```
frontend/   Next.js 14 (App Router) — canvas + CSS overlay, renders server state
server/     Fastify + Prisma + Postgres + Redis — the authoritative game engine
prototype/  the original single-file prototype (reference only)
docs/       deployment runbook
```

---

## What "server-authoritative" means here

The client never decides a price, a duration, a level gate or a balance. It
fetches the rules from `GET /api/config`, renders progress bars from the
server's timestamps, and calls the API for every action. Each action route
answers with the **full resolved farm snapshot**, and the client re-renders
from that — the server response always wins.

Three properties hold everywhere:

1. **One transaction per mutation.** Every economic change validates, mutates
   and writes exactly one `Ledger` row inside a single Prisma `$transaction`.
   If any part fails, none of it happened. The ledger sums reconcile against
   the farm balance at any moment.
2. **Timers resolve lazily.** No cron jobs, no per-farm intervals. Readiness is
   a pure function of `(stored rows, config, now)`, computed on every read and
   write against the server clock. A farm nobody has opened for a week settles
   in exactly one pass on its next request.
3. **One place for balance.** `server/src/config/gamedata.ts` holds every item,
   recipe, price, duration and level gate, with a single `TIME_SCALE` constant
   multiplying all durations.

---

## Running it locally

You need Node 20+, PostgreSQL and Redis.

```bash
cp .env.example .env          # then set JWT_SECRET to a long random string
npm install

createdb sunmill              # or point DATABASE_URL at any Postgres
npm run prisma:migrate --workspace=server
npm run seed --workspace=server

npm run dev --workspace=server     # API  on :4000
npm run dev --workspace=frontend   # web  on :3000
```

Open http://localhost:3000. Outside production the login screen offers
**Play as guest**, which needs no wallet.

### Checks

```bash
npm test                      # 34 unit tests: resolver, XP curve, capacity maths
npm run typecheck             # both workspaces

# 59 integration tests against a live Postgres + Redis: the whole production
# chain through all four machines and all three pens, wallet login with real
# signatures, the $HAY withdraw/deposit flows with the chain layer stubbed,
# and the tamper cases (a doctored order row, a poisoned market cache, a
# replayed nonce, a forged session cookie, a deposit confirmed five times).
npm run test:integration --workspace=server

node server/scripts/smoke.mjs             # 54 end-to-end API checks, real timers
node server/scripts/bench-resolve.ts      # resolver throughput, no DB
node server/scripts/loadtest.mjs          # concurrent GET /api/farm
npm i -D playwright && node frontend/scripts/browser-smoke.mjs   # 14 checks in a real browser
```

---

## TIME_SCALE — not locked in

`TIME_SCALE` multiplies every duration in the game. The tables in
`gamedata.ts` hold the prototype's demo-sped values, so:

| `TIME_SCALE` | Wheat | Sugarcane | Bread | Wool |
|---|---|---|---|---|
| `1` (default) | 9s | 1m 10s | 22s | 1m 10s |
| `20` (HANDOFF §2.1 suggestion) | 3m | 23m 20s | 7m 20s | 23m 20s |

**It ships at `1`, which is the prototype's demo pace, not a production
cadence.** HANDOFF §2.1 recommends 20 but explicitly leaves the decision open,
and CLAUDE.md says to ask rather than guess — so it is a single environment
variable, changed with a restart and no redeploy. The same goes for the
starting balances (640 coins, 8 $HAY), the level-up grant (+60 coins, +2 $HAY)
and the expansion costs: all demo placeholders sitting in `gamedata.ts`,
waiting on an economy pass.

Changing `TIME_SCALE` applies immediately to crops and animals. Machine jobs
already on the line keep the duration they were queued with, so a retune never
re-times work in progress.

---

## $HAY

Two balances, as HANDOFF §7 specifies:

- **In-game `hay`** — off-chain, in `Farm.hay`. What orders and level-ups grant
  and what expansions cost. Fully working, no chain involved.
- **On-chain `$HAY`** — real tokens, moved only through explicit
  withdraw/deposit flows.

The on-chain endpoints are **off by default** and refuse to run without
`HAY_ONCHAIN_ENABLED=true` *and* a fully configured treasury (RPC, token
address, treasury address, treasury key). Deposits are verified against the
chain — recipient, amount and confirmations — before crediting, and `txHash` is
unique in the database so the same deposit can never be credited twice.
Withdrawals have a rolling 24h cap, a manual-review threshold, and refund the
player if the broadcast fails. All of that is covered by integration tests that
run with the flag on and the chain layer stubbed — including confirming the
same deposit five times concurrently, which credits exactly once.

**Do not enable the flag until ALFA signs off on emission and sinks.**

---

## API

Every game route resolves timers first and returns the full snapshot. All input
is validated with zod, which rejects unknown fields. All action routes sit
behind a per-user Redis token bucket.

| Route | What it does |
|---|---|
| `GET /api/config` | Items, recipes, pens, level gates, `TIME_SCALE`. The client's only source of rules. |
| `POST /api/auth/nonce` · `POST /api/auth/wallet` | Wallet login: single-use nonce → signature → JWT in an httpOnly cookie. |
| `POST /api/auth/dev` | Signature-free login for local QA. Refused in production. |
| `GET /api/farm` | The resolved snapshot, with server time and the order board. |
| `POST /api/plant` | Sweep-plant: one call, many tiles, seed cost per tile. |
| `POST /api/harvest` | Tap a ready tile. Yield lands in the silo if it fits. |
| `POST /api/machine/queue` · `/collect` | Consume ingredients, take a slot; move finished goods to the barn. |
| `POST /api/pen/feed` · `/collect` | Whole pen, or one animal with `index`. |
| `GET /api/orders` · `POST /api/orders/deliver` · `/skip` | Board cached in Redis; rewards re-derived from config at delivery. |
| `GET /api/market` · `POST /api/market/buy` · `/sell` | Listings cached in Redis; prices re-checked against the legal band on every buy. |
| `POST /api/expand` | +20 silo or barn capacity for coins and $HAY. |
| `GET /api/hay/status` · `POST /api/hay/withdraw` · `/deposit/confirm` | Behind the feature flag. |

### What the server enforces

Farm ownership · level gates for crops, machines, recipes, pens and fields ·
silo/barn capacity before anything is added · ingredient availability with
atomic consume · timer completion before harvest or collect · balance before
any spend · a Ledger row on every credit and debit · idempotency on every
deposit `txHash`.

---

## Measured

On one container running Postgres, Redis, the API and the load generator
together (`TIME_SCALE=1`):

| | |
|---|---|
| `resolveFarm`, idle farm | ~12 µs — 84k farms/sec, single core |
| `resolveFarm`, busy farm mid-cycle | ~55 µs — 18k farms/sec |
| `resolveFarm`, untouched for a week | ~32 µs — neglect costs nothing extra |
| `GET /api/farm`, 200 concurrent farmers | 600 req/s, p50 8ms, p95 33ms, no errors |
| `GET /api/farm`, 500 concurrent farmers | saturates at ~970 req/s, p95 590ms, no errors |

The resolver is nowhere near the bottleneck; the database round trips are.
Deployment sizing is in `docs/RUNBOOK.md`.

---

## The art engine is off limits

`frontend/game/art.ts` and `art2.ts` are the prototype's `art.js` and `art2.js`
ported byte-for-byte — only the module wrapper changed. They are the product's
visual identity. Do not edit them; if a sprite needs to change, ask first
(CLAUDE.md golden rule 2).
