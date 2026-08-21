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
import { envOverrides, maskUrl, overrideAdvice } from '../src/lib/envfile';

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

describe('envOverrides', () => {
  const KEYS = ['DATABASE_URL', 'REDIS_URL'] as const;
  const file = {
    DATABASE_URL: 'postgresql://sunmil:pw@127.0.0.1:5433/sunmil?schema=public',
    REDIS_URL: 'redis://127.0.0.1:6379',
  };

  it('catches the port that was corrected in the file and not in the process', () => {
    const found = envOverrides(file, {
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
    expect(envOverrides(file, { ...file }, KEYS)).toEqual([]);
  });

  it('says nothing about a key the file does not set', () => {
    // Configuration that only exists in the environment is not a conflict.
    expect(envOverrides({ REDIS_URL: file.REDIS_URL }, file, KEYS)).toEqual([]);
    expect(envOverrides(undefined, file, KEYS)).toEqual([]);
  });

  it('ignores a key the process does not have', () => {
    expect(envOverrides(file, { REDIS_URL: file.REDIS_URL }, KEYS)).toEqual([]);
  });
});

describe('overrideAdvice', () => {
  it('names both addresses and the one command that clears it', () => {
    const lines = overrideAdvice({
      key: 'DATABASE_URL',
      file: 'postgresql://***@127.0.0.1:5433/sunmil',
      live: 'postgresql://***@127.0.0.1:5432/sunmil',
    }).join('\n');
    expect(lines).toContain(':5433');
    expect(lines).toContain(':5432');
    expect(lines).toContain('unset DATABASE_URL');
    expect(lines).toContain('pm2 delete sunmil-api');
  });
});
