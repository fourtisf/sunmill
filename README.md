# SUNMIL

A Hay Day-style production-chain farm game. The client is a procedural canvas
renderer; **everything economic lives on the server**.

`HANDOFF.md` is the product spec. `CLAUDE.md` is the working agreement for this
repo. `prototype/sunmil.html` is the original single-file prototype, kept as
the visual reference.

```
frontend/   Next.js 14 (App Router) — canvas + CSS overlay, renders server state
server/     Fastify + Prisma + Postgres + Redis — the authoritative game engine
prototype/  the original single-file prototype (reference only)
docs/       deployment runbook
```

**The loop:** plant → grow → harvest → craft through four machines → tend three
pens → deliver orders → buy and sell at the market → expand. On top of that:
pay $HAY to skip a timer, three daily tasks with a guide that walks you through
them, a seven-day login streak, a "while you were away" summary, capacity
upgrades to level 20, player names on a leaderboard, a virtual joystick, a
seven-step tutorial, procedural audio, and English/Indonesian throughout.

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

createdb sunmil              # or point DATABASE_URL at any Postgres
npm run prisma:migrate --workspace=server
npm run seed --workspace=server

npm run dev --workspace=server     # API  on :4000
npm run dev --workspace=frontend   # web  on :3000
```

Open http://localhost:3000. Outside production the login screen offers
**Play as guest**, which needs no wallet.

### Checks

```bash
npm test                      # 60 unit tests: resolver, XP curve, capacity maths,
                              # daily tasks, streak, away summary, speed-up pricing
npm run typecheck             # both workspaces

# 59 integration tests against a live Postgres + Redis: the whole production
# chain through all four machines and all three pens, wallet login with real
# signatures, the $HAY withdraw/deposit flows with the chain layer stubbed,
# and the tamper cases (a doctored order row, a poisoned market cache, a
# replayed nonce, a forged session cookie, a deposit confirmed five times).
npm run test:integration --workspace=server

node server/scripts/smoke.mjs             # 65 end-to-end API checks, real timers
node server/scripts/bench-resolve.ts      # resolver throughput, no DB
node server/scripts/loadtest.mjs          # concurrent GET /api/farm
npm i -D playwright && node frontend/scripts/browser-smoke.mjs   # 26 checks in a real browser
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

## The daily loop

Three tasks a day, drawn deterministically per farm per day so refreshing
cannot reroll into easier ones. Progress is bumped **only from inside the
action routes** — a client cannot advance its own task, and following the guide
is literally playing the game. Finishing all three pays a bonus.

Tapping **Show me** on a task hands it to the guide engine
(`frontend/game/guide.ts`), which spotlights the real thing to touch — the ripe
crop, the machine with goods waiting — and keeps guiding, with a live count,
until the task is actually complete and claimed. The same engine runs the
seven-step tutorial for a new farm; its progress is stored server-side, so it
never restarts after a reload.

Alongside that: a seven-day login streak that survives one missed day, orders
that expire, and a "while you were away" card summarising what finished during
a real absence — the server already knows, because readiness is derived from
timestamps.

## $HAY

Two balances, as HANDOFF §7 specifies:

- **In-game `hay`** — off-chain, in `Farm.hay`. What orders, level-ups, tasks
  and the streak grant, and what expansions, capacity upgrades and **speed-ups**
  cost. Fully working, no chain involved.
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

### The sink

`POST /api/speedup` pays $HAY to finish a timer now — a crop, a whole machine
queue, or a pen. It is the main demand-side for the token: before it existed,
orders and level-ups granted hay and only two expansions ever consumed any, so
balances could only grow. The price is derived server-side from the time
actually remaining (`SPEEDUP.hayPerMinute`, currently `0.15`), and
`/api/speedup/quote` lets the client show it without re-implementing the
formula. Capacity upgrades cost hay too, so the late game keeps draining it.

**The rate is a placeholder.** It is one number in `gamedata.ts` and needs the
same economy pass as `TIME_SCALE`.

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
| `GET /api/speedup/quote` · `POST /api/speedup` | Price and pay to finish a timer now — the $HAY sink. |
| `GET /api/upgrade` · `POST /api/upgrade` | Extra machine slots and extra animals, levels 11–18. |
| `POST /api/tasks/claim` · `POST /api/daily/claim` | Daily task rewards and the login streak. |
| `POST /api/profile` · `GET /api/leaderboard` | Player and farm name; ranking by level. |
| `POST /api/tutorial` | Remembers how far through the guide the player got. |
| `GET /api/admin/withdrawals` · `/release` · `/reject` | Operator tools for held withdrawals. |
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

## Late game

The prototype ran out of things to give at level 10. The curve now runs to
level 20 and 24 fields, and levels 11–18 sell extra machine slots and extra
animals for coins **and** $HAY.

Late progression is deliberately **scale, not new content**: the art engine is
fixed (see below), so every item that exists has a sprite and a new one would
not. More fields, more slots, more animals are all things the existing sprites
already draw.

## Language, sound and controls

- **English and Indonesian**, detected from the browser and switchable from the
  profile panel. Server notices and refusals travel as stable codes (`sold`,
  `insufficient_coins`) rather than prose, so they localise on the client.
- **Procedural audio** — synthesised with WebAudio for the same reason the art
  is procedural: no asset files, no cache-busting, a few hundred bytes of code
  instead of megabytes of samples. Muted from the profile panel.
- **A virtual joystick** walks the farmer with the camera following. It is DOM
  and CSS only and claims only pointers that start inside it, so tapping the
  world is untouched.

## Brand

The mark is a windmill standing in a sun — the sails are cut out of the disc
rather than drawn on it, so the two read as one struck shape. It is the Feed
Mill the player builds first. Logos, lockups, icons and
the social card live in `frontend/public/brand/`, all drawn as SVG including
the letters, so there is no font to load or licence. Raster sizes are generated
from those vectors by `frontend/scripts/build-brand-assets.mjs`, never
hand-edited. Usage rules, palette and minimum sizes: `docs/BRAND.md`.

## Closed beta

`INVITE_CODE` in `.env` puts a code gate on the landing page. It is enforced on
the server — no route that can open a session will do so without the cookie the
gate sets — so the code never ships to the browser and a client-side bypass buys
nothing. Unset means no gate, which is what local development and CI want.
Rotation, limits and what the gate does *not* protect against: `docs/RUNBOOK.md`
§10.

## The art engine is off limits

`frontend/game/art.ts` and `art2.ts` are the prototype's `art.js` and `art2.js`
ported byte-for-byte — only the module wrapper changed. They are the product's
visual identity. Do not edit them; if a sprite needs to change, ask first
(CLAUDE.md golden rule 2).
