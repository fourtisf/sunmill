#!/usr/bin/env node
/**
 * Load test for the lazy resolver, end to end through Fastify → Prisma →
 * Postgres. This is the path every action shares, so it is the one worth
 * measuring.
 *
 *   node server/scripts/loadtest.mjs [--users 200] [--seconds 15] [--rps 3]
 *                                     [--api http://127.0.0.1:4000]
 *
 * Signs in N virtual farmers with the dev login (so it only runs against a
 * non-production API), gives each a busy farm, then reads GET /api/farm
 * concurrently and reports throughput and latency percentiles.
 *
 * Each virtual farmer is paced at --rps requests per second, which is what the
 * per-user rate limit allows and roughly what the real client does. Load is
 * therefore scaled by adding users, not by hammering one of them; any 429s are
 * reported separately, since those are the limiter doing its job rather than
 * the server failing.
 */
const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? 'true']),
);
const BASE = args.api || process.env.API_URL || 'http://127.0.0.1:4000';
const USERS = Number(args.users || 200);
const SECONDS = Number(args.seconds || 15);
const RPS = Number(args.rps || 3);

async function call(method, path, body, cookie) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  const text = await res.text();
  return {
    status: res.status,
    cookie: setCookie ? setCookie.split(';')[0] : cookie,
    body: text ? JSON.parse(text) : null,
  };
}

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function main() {
  console.log(`signing in ${USERS} virtual farmers against ${BASE} …`);
  const sessions = [];
  for (let i = 0; i < USERS; i += 1) {
    const login = await call('POST', '/api/auth/dev', { handle: `load-${Date.now()}-${i}` });
    if (login.status !== 200) {
      console.error('dev login unavailable — is the API running with NODE_ENV != production?');
      process.exit(1);
    }
    sessions.push(login.cookie);
  }

  // Give every farm something to resolve: planted fields and a full craft queue.
  console.log('setting up busy farms (planted fields + queued crafts) …');
  for (const cookie of sessions) {
    await call('POST', '/api/plant', { tiles: [0, 1, 2, 3], crop: 'wheat' }, cookie);
    for (let i = 0; i < 3; i += 1) await call('POST', '/api/machine/queue', { machine: 'mill', recipeOut: 'cfeed' }, cookie);
    await call('POST', '/api/pen/feed', { pen: 'chicken' }, cookie);
  }

  console.log(`reading GET /api/farm for ${SECONDS}s — ${USERS} farmers at ${RPS} req/s each …\n`);
  const latencies = [];
  const errors = {};
  let rateLimited = 0;
  const gap = 1000 / RPS;
  const deadline = Date.now() + SECONDS * 1000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await Promise.all(sessions.map(async (cookie, i) => {
    // Stagger the start so the readers do not arrive in lockstep.
    await sleep((i % USERS) * (gap / USERS));
    while (Date.now() < deadline) {
      const started = Date.now();
      const t0 = process.hrtime.bigint();
      const res = await call('GET', '/api/farm', undefined, cookie);
      latencies.push(Number(process.hrtime.bigint() - t0) / 1e6);
      if (res.status === 429) rateLimited += 1;
      else if (res.status !== 200) errors[res.status] = (errors[res.status] || 0) + 1;
      const wait = gap - (Date.now() - started);
      if (wait > 0) await sleep(wait);
    }
  }));

  latencies.sort((a, b) => a - b);
  const total = latencies.length;
  const mean = latencies.reduce((a, b) => a + b, 0) / total;

  console.log(`requests      ${total.toLocaleString()} in ${SECONDS}s`);
  console.log(`throughput    ${Math.round(total / SECONDS).toLocaleString()} req/sec`);
  console.log(`latency mean  ${mean.toFixed(1)} ms`);
  console.log(`        p50   ${pct(latencies, 0.50).toFixed(1)} ms`);
  console.log(`        p95   ${pct(latencies, 0.95).toFixed(1)} ms`);
  console.log(`        p99   ${pct(latencies, 0.99).toFixed(1)} ms`);
  console.log(`        max   ${latencies[total - 1].toFixed(1)} ms`);
  console.log(`rate limited  ${rateLimited.toLocaleString()} (the per-user limiter, working as intended)`);
  console.log(`errors        ${Object.keys(errors).length ? JSON.stringify(errors) : 'none'}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
