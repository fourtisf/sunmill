# SUNMILL — Production Handoff

**Product:** Hay Day-style production-chain farm game, web (desktop + mobile browser).
**Token:** `$HAY` on Robinhood Chain (see §7 for what's on-chain vs off-chain).
**Prototype:** single-file `sunmill.html` — the visual + gameplay reference. Everything below describes turning that prototype into a persisted, multi-user, server-authoritative production build.
**Stack (locked to our standard):** Next.js 14 (App Router) · Fastify · Prisma · PostgreSQL · Redis · PM2 on Hostinger VPS.

---

## 0. READ FIRST — what the prototype is and isn't

The prototype (`sunmill.html`) is a **client-only, in-memory** proof of the game feel: procedural art engine, sweep-to-plant, timers, production chains, animals, orders, market, levels. **There is no backend, no persistence, no auth, no real economy.** Refresh = full reset. Timers run ~20x sped up so the whole loop is feelable in minutes.

**Your job:** keep the exact client art + feel, and move all *state and rules* to a server-authoritative backend. The client must never be trusted for coins, inventory, timers, or token balances.

**Do NOT rewrite the art engine.** `art.js` + `art2.js` (inside the HTML) are the visual identity — procedural canvas sprites. Port them as-is into the frontend as static modules. If a sprite renders in the prototype, it must render identically in prod.

---

## 1. Core game loop (authoritative spec)

1. **Plant** — player selects a seed, sweeps across owned field tiles. Each tile costs `seed` coins, deducted server-side. Tile enters `growing` with a server `plantedAt` timestamp.
2. **Grow** — real elapsed time. Crop is `ready` when `now >= plantedAt + grow_seconds`. **No client timers are authoritative** — client only renders progress from server timestamps.
3. **Harvest** — tap ready tile → yields `yield` units of the crop into the **silo** (if space). Grants XP.
4. **Craft** — machines (Feed Mill, Bakery, Dairy, Sugar Mill) consume inventory items and produce goods after `sec` seconds. Each machine has queue slots. Output lands in **barn** on collect.
5. **Animals** — pens (Chicken/Cow/Sheep). Feed with the matching feed good → animal produces after `sec` seconds → collect product into barn.
6. **Orders** — truck board. Fulfilling an order consumes items, grants coins + XP + **$HAY**.
7. **Market** — buy from generated neighbour listings, sell surplus for coins.
8. **Expand** — spend coins (+$HAY) to raise silo/barn capacity. Levels unlock fields/buildings/recipes.

---

## 2. Game data (source of truth — copy verbatim from prototype `game.js`)

These tables live in the prototype's `game.js`. **Move them to a server-side config module** (`/config/gamedata.ts`) so the client fetches balance from the server and cannot tamper with sell prices, grow times, or recipes.

### 2.1 Items
| id | name | type | sell | xp | grow(s) | seed | yield | unlock lvl |
|---|---|---|---|---|---|---|---|---|
| wheat | Wheat | crop | 3 | 1 | 9 | 1 | 3 | 1 |
| corn | Corn | crop | 9 | 2 | 22 | 4 | 2 | 1 |
| carrot | Carrot | crop | 16 | 3 | 34 | 8 | 2 | 2 |
| soybean | Soybean | crop | 24 | 4 | 50 | 13 | 2 | 4 |
| sugarcane | Sugarcane | crop | 38 | 5 | 70 | 21 | 2 | 6 |
| egg | Egg | good | 14 | 3 | — | — | — | (pen) |
| milk | Milk | good | 22 | 4 | — | — | — | (pen) |
| wool | Wool | good | 32 | 5 | — | — | — | (pen) |
| cfeed | Chicken Feed | good | 9 | 2 | — | — | — | (mill) |
| vfeed | Cow Feed | good | 16 | 3 | — | — | — | (mill) |
| sfeed | Sheep Feed | good | 22 | 4 | — | — | — | (mill) |
| bread | Bread | good | 28 | 5 | — | — | — | (bakery) |
| cake | Carrot Cake | good | 96 | 12 | — | — | — | (bakery) |
| cream | Cream | good | 54 | 7 | — | — | — | (dairy) |
| butter | Butter | good | 78 | 9 | — | — | — | (dairy) |
| sugar | Sugar | good | 48 | 6 | — | — | — | (sugarmill) |
| syrup | Syrup | good | 86 | 10 | — | — | — | (sugarmill) |

> **NOTE:** grow seconds in the table are the prototype's *demo-sped* values (~20x). For production, decide the real cadence. Recommended: multiply crop `grow` by ~20 for a Hay Day pace (wheat ~3min, sugarcane ~23min), and scale machine/animal `sec` similarly. Put a single `TIME_SCALE` constant in server config so we can tune globally. **Confirm with ALFA before locking.**

### 2.2 Machines (recipes: output ← inputs, seconds, unlock lvl)
- **Feed Mill** (lvl 1, 3 slots): cfeed ← {wheat:2, corn:1} 14s (lvl1) · vfeed ← {corn:2, soybean:1} 26s (lvl4) · sfeed ← {soybean:2, wheat:3} 34s (lvl6)
- **Bakery** (lvl 2, 3 slots): bread ← {wheat:3} 22s (lvl2) · cake ← {carrot:2, egg:2, sugar:1} 55s (lvl7)
- **Dairy** (lvl 3, 3 slots): cream ← {milk:2} 28s (lvl3) · butter ← {milk:3, sugar:1} 45s (lvl6)
- **Sugar Mill** (lvl 6, 3 slots): sugar ← {sugarcane:2} 30s (lvl6) · syrup ← {sugarcane:3, milk:1} 50s (lvl8)

### 2.3 Pens (feed → output, production seconds, animal count)
- **Chicken Coop** (lvl 1): cfeed → egg, 30s, 4 hens
- **Cow Pasture** (lvl 3): vfeed → milk, 48s, 3 cows
- **Sheep Fold** (lvl 6): sfeed → wool, 70s, 3 sheep

### 2.4 Progression
- Start: 640 coins, 8 $HAY (demo value — see §7), silo 60, barn 60, level 1.
- XP to next level: `round(18 + lvl*20 + lvl*lvl*3)`.
- Fields open per level: `[4,4,6,6,8,8,10,10,12,12,12]` (index by level, capped at 10).
- On level up: +2 $HAY, +60 coins (demo values — revisit for real economy), unlock per `LVLUP` table in prototype.

### 2.5 Order generation
- 1–3 distinct sellable items, quantities scaled by item value (cheap items 2–5, expensive 1–2).
- Reward: `coins = round(Σ sell*qty*1.5) + 4`, `xp = Σ item.xp*qty + 2`, `hay = round(coins/220*100)/100`.
- Board holds 4 orders; refills over time.

### 2.6 Market generation
- 6 listings, random sellable items, `price = round(sell * (1.2..1.7))`, qty 1–8 (cheap) / 1–4 (expensive).
- Refreshes ~every 75s (prototype) — for prod, refresh per-user on a fixed interval (e.g. 10 min) stored server-side.

---

## 3. Architecture

```
┌─────────────────────────────────────────────┐
│  Next.js 14 client (frontend/)              │
│  - Static procedural art engine (art, art2) │
│  - Canvas render loop (unchanged from proto)│
│  - UI overlay (HUD, dock, modals)           │
│  - Talks to API only; renders server state  │
└───────────────┬─────────────────────────────┘
                │ REST (JWT in httpOnly cookie)
┌───────────────▼─────────────────────────────┐
│  Fastify API (server/)                      │
│  - Auth (wallet + optional email)           │
│  - Server-authoritative game engine         │
│  - Lazy timer resolution (see §4)           │
│  - Rate limiting, validation (zod)          │
└─────┬───────────────────────┬───────────────┘
      │ Prisma                │ ioredis
┌─────▼─────────┐      ┌──────▼──────────────┐
│ PostgreSQL    │      │ Redis                │
│ users, farms, │      │ - session cache      │
│ tiles, machines,│    │ - market listings    │
│ pens, inventory,│    │ - order board cache  │
│ orders, ledger │     │ - rate-limit buckets │
└───────────────┘      └─────────────────────┘
                              │
                   ┌──────────▼───────────┐
                   │ Robinhood Chain      │
                   │ $HAY settlement      │
                   │ (deposit/withdraw)   │
                   └──────────────────────┘
```

---

## 4. The critical pattern: lazy server-authoritative timers

**Do not run cron jobs or setInterval per farm.** With many users that doesn't scale. Instead, **resolve time lazily on read/write**:

- Every timed entity (tile, machine job, animal) stores a **start timestamp** and duration.
- On *any* request that touches a farm (`GET /farm`, or any action), run `resolve(farm, now)`:
  - For each `growing` tile where `now >= plantedAt + grow`: mark `ready` (state only — do NOT auto-harvest; player must tap).
  - For each machine job where `now >= startedAt + sec` and it's the head of queue: move to `done`, start next queued job with `startedAt = completedAt` of the previous (preserve queue chaining exactly like the prototype).
  - For each animal where `now >= fedAt + sec`: mark `ready`.
- The client renders progress bars purely from `(now - startedAt) / duration`; it never decides completion.

This means state is always correct on read, with zero background workers. Redis can cache the resolved snapshot with a short TTL; invalidate on any write.

**Server clock is authoritative.** Client `now` is never trusted. All durations come from server config (§2), not the client.

---

## 5. Data model (Prisma sketch)

```prisma
model User {
  id        String   @id @default(cuid())
  wallet    String?  @unique          // Robinhood Chain address
  email     String?  @unique
  createdAt DateTime @default(now())
  farm      Farm?
  ledger    Ledger[]
}

model Farm {
  id        String   @id @default(cuid())
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id])
  coins     BigInt   @default(640)
  hay       Decimal  @default(0)      // off-chain game balance; see §7
  xp        Int      @default(0)
  level     Int      @default(1)
  siloCap   Int      @default(60)
  barnCap   Int      @default(60)
  updatedAt DateTime @updatedAt
  tiles     Tile[]
  machines  MachineState[]
  pens      PenState[]
  inventory InventoryItem[]
  orders    Order[]
}

model Tile {
  id        String   @id @default(cuid())
  farmId    String
  farm      Farm     @relation(fields: [farmId], references: [id])
  index     Int                        // 0..N field slot
  crop      String?                    // item id or null
  plantedAt DateTime?
  @@unique([farmId, index])
}

model MachineState {
  id       String  @id @default(cuid())
  farmId   String
  farm     Farm    @relation(fields: [farmId], references: [id])
  machine  String                      // 'mill' | 'bakery' | 'dairy' | 'sugar'
  jobs     Json     @default("[]")     // [{out, sec, startedAt}] — head is active
  done     Json     @default("{}")     // {itemId: qty} awaiting collect
  @@unique([farmId, machine])
}

model PenState {
  id      String  @id @default(cuid())
  farmId  String
  farm    Farm    @relation(fields: [farmId], references: [id])
  pen     String                       // 'chicken' | 'cow' | 'sheep'
  animals Json                         // [{state:'hungry'|'full'|'ready', fedAt}]
  @@unique([farmId, pen])
}

model InventoryItem {
  id     String @id @default(cuid())
  farmId String
  farm   Farm   @relation(fields: [farmId], references: [id])
  item   String
  qty    Int    @default(0)
  @@unique([farmId, item])
}

model Order {
  id        String   @id @default(cuid())
  farmId    String
  farm      Farm     @relation(fields: [farmId], references: [id])
  items     Json                        // {itemId: qty}
  coins     Int
  xp        Int
  hay       Decimal
  createdAt DateTime @default(now())
}

model Ledger {                          // audit trail — every economic mutation
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  kind      String                      // 'harvest'|'craft'|'sell'|'buy'|'order'|'expand'|'hay_deposit'|'hay_withdraw'|'levelup'
  detail    Json
  coinsDelta BigInt  @default(0)
  hayDelta  Decimal  @default(0)
  createdAt DateTime @default(now())
  @@index([userId, createdAt])
}
```

Market listings + order board **cache in Redis** per user (regenerated on interval), not necessarily persisted — but the *reward math* is validated server-side at fulfilment time against server config.

---

## 6. API endpoints (all server-authoritative, all validated with zod)

Auth: JWT in httpOnly cookie. Every game route resolves timers (§4) before responding and returns the **full resolved farm snapshot** so the client re-syncs.

```
POST /api/auth/wallet         { address, signature }        → session
POST /api/auth/nonce          { address }                   → nonce to sign
GET  /api/farm                                              → full farm snapshot (resolved)

POST /api/plant               { tiles:[index], crop }        → snapshot   (deduct seed*count, validate ownership+level+space)
POST /api/harvest             { tile:index }                 → snapshot   (must be ready; add yield if silo space; +xp)
POST /api/machine/queue       { machine, recipeOut }         → snapshot   (validate ingredients+slot free; consume; enqueue)
POST /api/machine/collect     { machine }                    → snapshot   (move done→barn if space; +xp)
POST /api/pen/feed            { pen, index? }                → snapshot   (consume feed; set full+fedAt)   index optional = feed all
POST /api/pen/collect         { pen, index? }                → snapshot   (ready→barn; +xp)
GET  /api/orders                                            → order board (cached)
POST /api/orders/deliver      { orderId }                    → snapshot   (validate items; consume; +coins+xp+hay; refill)
POST /api/orders/skip         { orderId }                    → order board (refill)
GET  /api/market                                            → listings (cached)
POST /api/market/buy          { listingId }                  → snapshot   (deduct coins; +item if space; dec listing qty)
POST /api/market/sell         { item, qty }                  → snapshot   (remove item; +coins; +small xp)
POST /api/expand              { target:'silo'|'barn' }       → snapshot   (deduct coins+hay; +20 cap)

POST /api/hay/withdraw        { amount }                     → tx intent  (game hay → on-chain $HAY; see §7)
POST /api/hay/deposit/confirm { txHash }                     → snapshot   (credit game hay after on-chain confirm)
```

**Validation rules that MUST live server-side (never trust client):**
- Ownership of farm/tile/machine/pen.
- Level gate for crops, machines, recipes, pens, fields.
- Silo/barn capacity before adding anything.
- Ingredient availability + atomic consume (DB transaction).
- Timer completion (`ready` state) before harvest/collect.
- Coin/HAY balance before any spend. All spends + credits write a **Ledger** row in the same transaction.

Use Prisma `$transaction` for every mutation so inventory/coins/hay never desync. Rate-limit action routes in Redis (e.g. per-user token bucket) to stop scripted spam.

---

## 7. $HAY / on-chain (Robinhood Chain) — scope carefully

**Two-balance model:**
- **In-game `hay`** (soft, off-chain, in `Farm.hay`): what orders and level-ups grant, what expansions cost. Keeps the moment-to-moment economy free of gas + chain latency. This is the number shown in the HUD.
- **On-chain `$HAY`** (real token): players **withdraw** game hay → on-chain, and **deposit** on-chain → game hay, through explicit flows only.

**Flows:**
- **Withdraw:** `POST /api/hay/withdraw {amount}` → server checks `Farm.hay >= amount`, debits it, writes a pending Ledger row, and triggers an on-chain transfer of `$HAY` from the treasury to the user's wallet. Mark Ledger settled on tx confirm.
- **Deposit:** user sends `$HAY` to treasury → `POST /api/hay/deposit/confirm {txHash}` → server verifies the tx on Robinhood Chain, credits `Farm.hay`, writes Ledger.

**Security / must-haves before any real token moves:**
- Treasury key in server env only, never in client.
- Verify every deposit tx on-chain (amount, recipient, confirmations) before crediting.
- Idempotency on `txHash` (unique) so a deposit can't be double-credited.
- Withdraw rate limits + a max-per-day cap; consider a manual review threshold.
- The demo starting balances (8 hay, +2/level) are **prototype placeholders** — the real emission schedule / sink balance is an economy decision. **Do not ship real-token withdraw until ALFA signs off on emission + sinks.** Ship the game with off-chain `hay` first; gate the withdraw/deposit endpoints behind a feature flag.

---

## 8. Frontend porting notes

- Move the `<script>` bundle from `sunmill.html` into modules under `frontend/game/`: `art.ts`, `art2.ts` (procedural sprites — **do not modify**), `render.ts` (loop/camera), `ui.ts` (overlay), `net.ts` (new — API client).
- Delete the in-memory `S` state object's role as source of truth. Replace with: client holds a **mirror** of the server snapshot; every action calls the API, then re-renders from the returned snapshot. Optimistic UI is OK for responsiveness, but the server response always wins (reconcile).
- Timers: client keeps rendering progress from `startedAt`/`plantedAt` timestamps in the snapshot (server time). Send a server-time offset with each snapshot so client clock skew doesn't matter.
- Keep the exact CSS/UI in the `<head>` — that's the visual identity.
- Canvas: the render loop is fine as-is; just feed it server state instead of local `S`.

---

## 9. Known prototype gaps to fix in prod (ALFA is aware)

1. **Camera framing** — default view sits slightly high on narrow screens; left-column machines can clip. Tune center + zoom bounds in `render.ts`.
2. **No persistence** in prototype — that's exactly what this backend adds.
3. **Economy balance** (prices, XP curve, HAY emission, sinks) is rough — needs a real tuning pass before launch, ideally behind config so we can adjust without redeploy.
4. **No audio.**
5. **TIME_SCALE** — prototype runs ~20x fast for demo. Prod must set the real cadence in server config (§2.1).

---

## 10. Suggested build order

1. Scaffold Next.js 14 + Fastify + Prisma + Postgres + Redis; PM2 ecosystem file; env config.
2. Prisma schema (§5) + migrations; seed a dev user + farm.
3. Server game-config module (§2) with `TIME_SCALE`.
4. `resolve(farm, now)` timer engine (§4) with unit tests (plant→ready, queue chaining, animal cycle).
5. Auth (wallet nonce/sign) + `GET /api/farm`.
6. Action endpoints (§6) one system at a time: plant/harvest → machines → pens → orders → market → expand. Each in a Prisma transaction + Ledger row + zod validation + Redis rate limit.
7. Port frontend art + render + UI; wire `net.ts` to the API; reconcile snapshots.
8. Redis caching for market/order board.
9. $HAY endpoints (§7) **behind a feature flag**, off-chain hay working first.
10. Load-test the lazy resolver; add indices; QA the full loop end-to-end.

**Definition of done for v1:** a logged-in user can plant, harvest, craft through all four machines, tend all three pens, deliver orders, buy/sell in market, and expand — all persisted across sessions and server-authoritative, with a full Ledger audit trail. On-chain withdraw/deposit stubbed behind a flag, off-chain `hay` fully functional.
