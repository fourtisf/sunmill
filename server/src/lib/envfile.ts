/**
 * What this process is actually configured with, and where that came from.
 *
 * dotenv never overwrites a variable that is already set. That is the right
 * default — an operator overriding one value for one run should win — but it
 * makes the opposite case invisible: a stale value already in the environment
 * silently beats the file everyone edits.
 *
 * PM2 turns that from an edge case into the normal one. Its daemon inherits
 * the environment of whatever shell first started it and hands that to every
 * app it spawns, so a single `export DATABASE_URL=...` outlives every deploy,
 * every reload and every correction to .env. The file then reads correctly,
 * `pg_isready` answers on the port the file names, and the API quietly dials
 * somewhere else — reporting only that it cannot reach a database, without
 * ever saying which one it tried.
 */

/** A connection URL with its credentials removed, safe to put in a log line. */
export function maskUrl(value: string): string {
  const raw = String(value ?? '');
  // The query string carries no identity and only makes the line long.
  const noQuery = raw.replace(/\?.*$/, '');
  // Everything between :// and the last @ is credentials. Greedy on purpose:
  // a password may contain an @.
  return noQuery.replace(/^([a-zA-Z][\w+.-]*:\/\/).*@/, '$1***@');
}

export interface EnvOverride {
  key: string;
  /** What .env says, masked. */
  file: string;
  /** What this process actually has, masked. */
  live: string;
}

/**
 * Which of `keys` the environment is overriding the file on. Only keys the
 * file actually sets can be overridden — a value that exists nowhere else is
 * simply configuration, not a conflict.
 */
export function envOverrides(
  parsed: Record<string, string> | undefined,
  env: Record<string, string | undefined>,
  keys: readonly string[],
): EnvOverride[] {
  if (!parsed) return [];
  const out: EnvOverride[] = [];
  for (const key of keys) {
    const file = parsed[key];
    const live = env[key];
    if (file != null && live != null && live !== file) {
      out.push({ key, file: maskUrl(file), live: maskUrl(live) });
    }
  }
  return out;
}

/** The lines an operator needs, in the log they already read after a deploy. */
export function overrideAdvice(o: EnvOverride, app = 'sunmil-api'): string[] {
  return [
    `[sunmil] ${o.key} from the environment is overriding .env — dotenv does not`,
    '[sunmil]   overwrite a variable that is already set, so the file loses.',
    `[sunmil]   .env says:        ${o.file}`,
    `[sunmil]   this process has: ${o.live}`,
    '[sunmil]   PM2 gives its daemon\'s environment to every app it starts, so this',
    '[sunmil]   survives reload and restart. To clear it:',
    `[sunmil]     unset ${o.key} && pm2 delete ${app} && pm2 start ecosystem.config.js --env production`,
  ];
}
