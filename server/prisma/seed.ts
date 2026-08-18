/**
 * Dev seed: one user with a fresh farm — 12 tile slots, four machines, three
 * pens, and the starting balances from gamedata. Idempotent.
 *
 *   npm run seed --workspace=server
 */
import { PrismaClient } from '@prisma/client';
import { createFarm, ensureFarmShape } from '../src/engine/bootstrap';
import { START } from '../src/config/gamedata';

const prisma = new PrismaClient();

const DEV_EMAIL = 'farmer@dev.local';
const DEV_WALLET = '0x00000000000000000000000000000000000f4a12';

async function main() {
  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { email: DEV_EMAIL },
      include: { farm: true },
    });
    if (existing) {
      if (!existing.farm) await createFarm(tx, existing.id);
      else await ensureFarmShape(tx, existing.farm.id);
      return existing;
    }
    const created = await tx.user.create({ data: { email: DEV_EMAIL, wallet: DEV_WALLET } });
    await createFarm(tx, created.id);
    return created;
  });

  const farm = await prisma.farm.findUnique({
    where: { userId: user.id },
    include: { tiles: true, machines: true, pens: true, inventory: true },
  });

  // eslint-disable-next-line no-console
  console.log([
    'seeded:',
    `  user     ${user.id} (${DEV_EMAIL})`,
    `  farm     ${farm?.id}`,
    `  coins    ${farm?.coins}  hay ${farm?.hay}`,
    `  tiles    ${farm?.tiles.length}`,
    `  machines ${farm?.machines.map((m) => m.machine).join(', ')}`,
    `  pens     ${farm?.pens.map((p) => p.pen).join(', ')}`,
    `  starting inventory ${JSON.stringify(START.inventory)}`,
    '',
    `log in locally with:  POST /api/auth/dev {"handle":"farmer"}`,
  ].join('\n'));
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
