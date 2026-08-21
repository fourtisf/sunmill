/**
 * The silent misconfiguration.
 *
 * `.env` named 127.0.0.1:5433, Postgres was listening there, pg_isready was
 * green — and the API reported a database it could not reach. dotenv does not
 * overwrite a variable that is already set, and PM2 hands its daemon's
 * environment to every app it spawns, so a stale export beat the file and
 * nothing anywhere said which address was actually dialled.
 */
import { describe, expect, it } from 'vitest';
import { applyFileWins, conflictAdvice, envConflicts, maskUrl } from '../src/lib/envfile';

describe('maskUrl', () => {
  it('keeps the part that identifies the server and drops the part that does not', () => {
    expect(maskUrl('postgresql://sunmil:s3cret@127.0.0.1:5433/sunmil?schema=public&connection_limit=20'))
      .toBe('postgresql://***@127.0.0.1:5433/sunmil');
    expect(maskUrl('redis://127.0.0.1:6379')).toBe('redis://127.0.0.1:6379');
  });

  it('is greedy to the last @, because a password may contain one', () => {
    expect(maskUrl('postgresql://sunmil:p@ss@db.internal:5432/sunmil'))
      .toBe('postgresql://***@db.internal:5432/sunmil');
  });

  it('never leaks the password, whatever it is given', () => {
    for (const url of [
      'postgresql://u:hunter2@h:5432/d?x=1',
      'postgres://u:hunter2@h/d',
      'rediss://default:hunter2@h:6380',
    ]) expect(maskUrl(url)).not.toContain('hunter2');
  });

  it('does not choke on something that is not a URL', () => {
    expect(maskUrl('')).toBe('');
    expect(maskUrl(undefined as unknown as string)).toBe('');
    expect(maskUrl('not a url')).toBe('not a url');
  });
});

describe('envConflicts', () => {
  const KEYS = ['DATABASE_URL', 'REDIS_URL'] as const;
  const file = {
    DATABASE_URL: 'postgresql://sunmil:pw@127.0.0.1:5433/sunmil?schema=public',
    REDIS_URL: 'redis://127.0.0.1:6379',
  };

  it('catches the port that was corrected in the file and not in the process', () => {
    const found = envConflicts(file, {
      ...file,
      DATABASE_URL: 'postgresql://sunmil:pw@127.0.0.1:5432/sunmil?schema=public',
    }, KEYS);
    expect(found).toHaveLength(1);
    expect(found[0].key).toBe('DATABASE_URL');
    // Both sides shown, because which is which is the whole question.
    expect(found[0].file).toContain(':5433');
    expect(found[0].live).toContain(':5432');
    expect(JSON.stringify(found)).not.toContain('pw@');
  });

  it('says nothing when they agree', () => {
    expect(envConflicts(file, { ...file }, KEYS)).toEqual([]);
  });

  it('says nothing about a key the file does not set', () => {
    // Configuration that only exists in the environment is not a conflict.
    expect(envConflicts({ REDIS_URL: file.REDIS_URL }, file, KEYS)).toEqual([]);
    expect(envConflicts(undefined, file, KEYS)).toEqual([]);
  });

  it('ignores a key the process does not have', () => {
    expect(envConflicts(file, { REDIS_URL: file.REDIS_URL }, KEYS)).toEqual([]);
  });
});

describe('applyFileWins', () => {
  const file = {
    DATABASE_URL: 'postgresql://sunmil:pw@127.0.0.1:5433/sunmil?schema=public',
    REDIS_URL: 'redis://127.0.0.1:6379',
  };

  it('hands the connection back to the file', () => {
    // The live incident, exactly: .env corrected to 5433, a stale 5432 in the
    // process environment, and dotenv refusing to overwrite it.
    const env: Record<string, string | undefined> = {
      DATABASE_URL: 'postgresql://sunmil:pw@127.0.0.1:5432/sunmil?schema=public',
      REDIS_URL: file.REDIS_URL,
    };
    expect(applyFileWins(file, env)).toEqual(['DATABASE_URL']);
    expect(env.DATABASE_URL).toBe(file.DATABASE_URL);
  });

  it('changes nothing when they already agree', () => {
    const env = { ...file };
    expect(applyFileWins(file, env)).toEqual([]);
    expect(env).toEqual(file);
  });

  it('leaves NODE_ENV to the launcher', () => {
    // ecosystem.config.js sets NODE_ENV=production; a .env copied from
    // .env.example still says development. The file must not win there, or a
    // deploy quietly turns the box into a development one — dev login and all.
    const env: Record<string, string | undefined> = { NODE_ENV: 'production' };
    applyFileWins({ ...file, NODE_ENV: 'development' }, env);
    expect(env.NODE_ENV).toBe('production');
  });

  it('sets a key the process does not have at all', () => {
    const env: Record<string, string | undefined> = {};
    expect(applyFileWins(file, env).sort()).toEqual(['DATABASE_URL', 'REDIS_URL']);
    expect(env.DATABASE_URL).toBe(file.DATABASE_URL);
  });
});

describe('conflictAdvice', () => {
  const conflict = {
    key: 'DATABASE_URL',
    file: 'postgresql://***@127.0.0.1:5433/sunmil',
    live: 'postgresql://***@127.0.0.1:5432/sunmil',
  };

  it('says which address is in use when the file wins', () => {
    const lines = conflictAdvice(conflict, true).join('\n');
    expect(lines).toContain('using (.env):     postgresql://***@127.0.0.1:5433/sunmil');
    expect(lines).toContain('ignored (env):    postgresql://***@127.0.0.1:5432/sunmil');
    expect(lines).toContain('pm2 kill');
  });

  it('says the file lost when it did', () => {
    const lines = conflictAdvice(conflict, false).join('\n');
    expect(lines).toContain('overriding .env');
    expect(lines).toContain(':5432');
  });
});
