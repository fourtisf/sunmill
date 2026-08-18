# CLAUDE.md — SUNMILL build instructions for Claude Code

You are building the production backend + frontend port for **SUNMILL**, a Hay Day-style farm game. Read `HANDOFF.md` in full before writing any code — it is the authoritative spec. This file tells you *how* to work in this repo.

## Golden rules

1. **Server is authoritative for everything economic.** Coins, inventory, XP, level, capacities, timers, and $HAY are decided by the server from server-side config. The client is a renderer. Never trust a client-supplied amount, timestamp, price, or completion state.
2. **Do NOT modify the art engine.** `art.ts` / `art2.ts` (ported from the prototype's `art.js` / `art2.js`) are procedural canvas sprites and are the product's visual identity. Port them verbatim. If you think a sprite needs changing, stop and ask — don't edit.
3. **Every economic mutation is a single Prisma `$transaction`** that (a) validates, (b) mutates farm/inventory, and (c) writes one `Ledger` row. If any step fails, the whole thing rolls back.
4. **Timers resolve lazily** (see HANDOFF §4). No per-farm cron/setInterval. Resolve on every farm read/write against the **server** clock.
5. **All input validated with zod** at the route boundary. Reject unknown fields.
6. **Game balance lives in one config module** (`server/config/gamedata.ts`) with a single `TIME_SCALE` constant. Never hardcode item prices, grow times, or recipes anywhere else.

## Stack & conventions

- **Frontend:** Next.js 14 (App Router), TypeScript, no heavy UI framework — keep the prototype's plain canvas + CSS overlay. Fetch state via a small `net.ts` client.
- **Backend:** Fastify (TypeScript), zod for validation, Prisma ORM.
- **DB:** PostgreSQL via Prisma. **Redis** (ioredis) for session cache, market/order-board cache, and rate-limit buckets.
- **Process:** PM2 with an `ecosystem.config.js`. Two apps: `sunmill-web` (Next) and `sunmill-api` (Fastify).
- **Env:** all secrets (DB URL, JWT secret, Redis URL, Robinhood Chain RPC + treasury key) in `.env`, never committed, never sent to client. Provide `.env.example`.
- **Money types:** coins = `BigInt`, hay = `Decimal`. Never floats for balances.
- **Auth:** wallet nonce → sign → JWT in httpOnly, secure, sameSite cookie.

## Build order (do these in sequence, commit after each)

Follow HANDOFF §10. Do not jump ahead. After each system, write a quick test proving the loop works before moving on.

1. Scaffold monorepo (`frontend/`, `server/`), PM2 ecosystem, `.env.example`, Prisma init.
2. Prisma schema from HANDOFF §5 + first migration + dev seed (one user + farm + empty tiles/machines/pens).
3. `server/config/gamedata.ts` — items, machines, pens, progression, order/market gen params, `TIME_SCALE`. Export typed.
4. `server/engine/resolve.ts` — the lazy timer resolver. **Write unit tests first**: (a) tile plant→ready boundary, (b) machine queue chaining (next job starts when prev completes), (c) animal feed→ready cycle. All using injected `now`.
5. Auth routes + `GET /api/farm` returning a resolved snapshot (+ server-time offset).
6. Action routes one at a time (plant → harvest → machine queue/collect → pen feed/collect → orders deliver/skip → market buy/sell → expand). Each: zod → ownership/level/space/balance checks → `$transaction` → Ledger → return full snapshot. Add Redis rate-limit to each.
7. Redis caching for market + order board (per-user, interval refresh; reward math re-validated at fulfilment).
8. Port frontend: move prototype `<script>` into `frontend/game/` modules. Replace the in-memory `S` object as source-of-truth with a server-snapshot mirror; every action calls the API and re-renders from the response (optimistic OK, server reconciles).
9. `$HAY` endpoints (HANDOFF §7) **behind a feature flag**, off-chain `hay` working first. Do NOT enable real on-chain withdraw without explicit sign-off.
10. Load-test the resolver, add DB indices, full end-to-end QA.

## Validation checklist the server MUST enforce (HANDOFF §6)

- Farm/tile/machine/pen ownership.
- Level gates: crop, machine, recipe, pen, field count (`[4,4,6,6,8,8,10,10,12,12,12]`).
- Silo/barn capacity before adding items (crops→silo, goods→barn).
- Ingredient availability + atomic consume; machine slot free.
- Timer `ready` before harvest/collect.
- Balance before spend; Ledger row on every credit/debit.
- Idempotency on any $HAY deposit `txHash`.

## What NOT to do

- Don't put game rules or prices in the client.
- Don't auto-harvest on the server (player taps ready crops/goods; server only marks `ready`).
- Don't run background workers for timers.
- Don't move real $HAY without the feature flag + sign-off.
- Don't edit `art.ts` / `art2.ts`.
- Don't use floats for coins/hay.
- Don't skip the Ledger — every economic change is audited.

## Definition of done (v1)

A persisted, server-authoritative farm: plant, harvest, craft through all 4 machines, tend all 3 pens, deliver orders, buy/sell market, expand — surviving refresh and sessions, with a full Ledger. On-chain $HAY stubbed behind a flag; off-chain `hay` fully working. Frontend renders identically to the prototype.

When in doubt about economy numbers (TIME_SCALE, HAY emission, sinks), stop and ask ALFA rather than guessing.
