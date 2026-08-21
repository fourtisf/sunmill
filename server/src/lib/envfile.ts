/**
 * Which configuration wins, and saying so.
 *
 * dotenv never overwrites a variable that is already set. That default is
 * right when nobody named a file — the environment IS the configuration, and
 * `DATABASE_URL=... npm start` should work. It is wrong the moment somebody
 * points at a specific file and says "this is the configuration", which is
 * exactly what ecosystem.config.js does for the API: it sets
 * DOTENV_CONFIG_PATH to the repo-root .env.
 *
 * PM2 makes the difference matter. Its daemon inherits the environment of
 * whatever shell first started it and hands that to every app it spawns, so a
 * single `export DATABASE_URL=...` outlives every deploy, reload, restart and
 * correction to .env. The file then reads correctly to everyone who opens it,
 * pg_isready answers on the port the file names, and the API quietly dials
 * somewhere else — reporting only that it cannot reach a database, never
 * which one it tried. That took a live site down for hours.
 *
 * So when the path is explicit, the file wins for the values that decide which
 * server this process talks to, and the conflict goes in the log either way.
 */

/**
 * The values that decide which servers this process talks to, and which port
 * it answers on.
 *
 * API_PORT is in the list for the same reason, from the other direction: this
 * VPS hosts more than one site, and a neighbouring project's PM2 config reads
 * a variable of exactly this name with exactly this default. Left to the
 * environment, whichever of them starts second binds a port already taken and
 * dies — so the port SUNMIL answers on is decided by SUNMIL's own .env.
 */
export const FILE_WINS = ['DATABASE_URL', 'REDIS_URL', 'API_PORT'] as const;

/** A connection URL with its credentials removed, safe to put in a log line. */
export function maskUrl(value: string): string {
  const raw = String(value ?? '');
  // The query string carries no identity and only makes the line long.
  const noQuery = raw.replace(/\?.*$/, '');
  // Everything between :// and the last @ is credentials. Greedy on purpose:
  // a password may contain an @.
  return noQuery.replace(/^([a-zA-Z][\w+.-]*:\/\/).*@/, '$1***@');
}

export interface EnvConflict {
  key: string;
  /** What the file says, masked. */
  file: string;
  /** What the process already had, masked. */
  live: string;
}

/**
 * Where the file and the environment disagree. Only keys the file actually
 * sets can conflict — a value that exists nowhere else is configuration, not a
 * disagreement. Pure: call it before anything is applied.
 */
export function envConflicts(
  parsed: Record<string, string> | undefined,
  env: Record<string, string | undefined>,
  keys: readonly string[] = FILE_WINS,
): EnvConflict[] {
  if (!parsed) return [];
  const out: EnvConflict[] = [];
  for (const key of keys) {
    const file = parsed[key];
    const live = env[key];
    if (file != null && live != null && live !== file) {
      out.push({ key, file: maskUrl(file), live: maskUrl(live) });
    }
  }
  return out;
}

/**
 * Hand the named keys back to the file. Returns the keys it changed.
 *
 * Deliberately narrow: NODE_ENV is not in it, because the launcher is what
 * decides that — ecosystem.config.js sets NODE_ENV=production and a .env
 * copied from .env.example still says development. Letting the file win there
 * would turn a production box into a development one, dev login route and all.
 */
export function applyFileWins(
  parsed: Record<string, string> | undefined,
  env: Record<string, string | undefined>,
  keys: readonly string[] = FILE_WINS,
): string[] {
  if (!parsed) return [];
  const changed: string[] = [];
  for (const key of keys) {
    const file = parsed[key];
    if (file != null && env[key] !== file) {
      env[key] = file;
      changed.push(key);
    }
  }
  return changed;
}

/** The lines an operator needs, in the log they already read after a deploy. */
export function conflictAdvice(c: EnvConflict, fileWon: boolean): string[] {
  if (fileWon) {
    return [
      `[sunmil] ${c.key}: .env and this process disagreed. The file wins, because`,
      '[sunmil]   DOTENV_CONFIG_PATH named it — see server/src/lib/envfile.ts.',
      `[sunmil]   using (.env):     ${c.file}`,
      `[sunmil]   ignored (env):    ${c.live}`,
      '[sunmil]   That stale value is usually PM2 handing its daemon\'s environment to',
      `[sunmil]   every app it starts. To clear it: unset ${c.key} && pm2 kill && pm2 start ecosystem.config.js --env production`,
    ];
  }
  return [
    `[sunmil] ${c.key} from the environment is overriding .env — dotenv does not`,
    '[sunmil]   overwrite a variable that is already set, so the file loses.',
    `[sunmil]   .env says:        ${c.file}`,
    `[sunmil]   this process has: ${c.live}`,
  ];
}
