import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/config.js';
import { InMemoryTokenBucket } from '../src/tenancy/rate-limiter.js';
import { ApiKeyVerifier } from '../src/auth/api-keys.js';
import { BASE_ENV } from './support.js';

function errorsOf(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  return [];
}

describe('config', () => {
  it('fails fast listing every missing variable, without echoing values', () => {
    const issues = errorsOf({ LLM_PROVIDER: 'openai', API_KEYS: 'short-secret-value' });
    expect(issues.join('\n')).toMatch(/DATABASE_URL: required/);
    expect(issues.join('\n')).toMatch(/OPENAI_API_KEY: required/);
    expect(issues.join('\n')).toMatch(/API_KEYS/);
    expect(issues.join('\n')).not.toContain('short-secret-value');
  });

  it('validates the Azure provider separately', () => {
    const issues = errorsOf({ ...BASE_ENV, LLM_PROVIDER: 'azure-openai', OPENAI_API_KEY: undefined });
    expect(issues).toEqual(
      expect.arrayContaining([
        'AZURE_OPENAI_API_KEY: required',
        'AZURE_OPENAI_ENDPOINT: required',
        'AZURE_OPENAI_DEPLOYMENT: required',
      ]),
    );
  });

  it('refuses wildcard CORS, unsafe schema names and "none" JWT algorithms', () => {
    expect(errorsOf({ ...BASE_ENV, CORS_ORIGINS: '*' }).join()).toMatch(/CORS_ORIGINS/);
    expect(errorsOf({ ...BASE_ENV, DB_SCHEMA: 'agent"; DROP TABLE x; --' }).join()).toMatch(/DB_SCHEMA/);
    const jwt = { AUTH_MODE: 'jwt', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', JWT_SECRET: 'x'.repeat(32) };
    expect(errorsOf({ ...BASE_ENV, ...jwt, JWT_ALGORITHMS: 'none' }).join()).toMatch(/none/);
  });

  it('defaults to safe values', () => {
    const config = loadConfig(BASE_ENV);
    expect(config.otel.captureContent).toBe(false);
    expect(config.http.corsOrigins).toEqual([]);
    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe('building blocks', () => {
  it('token bucket refills over time', async () => {
    let now = 0;
    const bucket = new InMemoryTokenBucket({ perMinute: 60, burst: 1 }, () => now);
    expect((await bucket.consume('a')).allowed).toBe(true);
    expect(await bucket.consume('a')).toEqual({ allowed: false, retryAfterSeconds: 1 });
    now += 1_000;
    expect((await bucket.consume('a')).allowed).toBe(true);
  });

  it('API key verifier accepts only configured keys', () => {
    const verifier = new ApiKeyVerifier(['a'.repeat(32), 'b'.repeat(32)]);
    expect(verifier.verify('b'.repeat(32))).toMatch(/^[0-9a-f]{8}$/);
    expect(verifier.verify('c'.repeat(32))).toBeNull();
    expect(verifier.verify('')).toBeNull();
  });
});
