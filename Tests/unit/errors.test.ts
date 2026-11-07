import { describe, expect, it } from 'vitest';
import { ERROR_CODES, UniHubApiError, UniHubError } from '../../src/errors';
import { MESSAGES, message } from '../../src/i18n';

describe('error codes and messages', () => {
  it('every code has a non-empty message in every locale', () => {
    for (const locale of Object.keys(MESSAGES) as (keyof typeof MESSAGES)[]) {
      for (const code of ERROR_CODES) {
        expect(MESSAGES[locale][code], `${locale}.${code}`).toMatch(/\S/);
      }
    }
  });

  it('no locale has a message for a code that does not exist', () => {
    for (const table of Object.values(MESSAGES)) {
      expect(Object.keys(table).sort()).toEqual([...ERROR_CODES].sort());
    }
  });

  it('defaults to Turkish and falls back to it for an unknown locale', () => {
    expect(message('NETWORK')).toBe(MESSAGES.tr.NETWORK);
    expect(message('NETWORK', 'en')).toBe(MESSAGES.en.NETWORK);
    expect(message('NETWORK', 'de' as never)).toBe(MESSAGES.tr.NETWORK);
  });
});

describe('UniHubError', () => {
  it('carries code, status, details and a localised message', () => {
    const e = new UniHubError('RATE_LIMITED', 429, { locale: 'en', details: { retryAfterMs: 2000 } });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('UniHubError');
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.status).toBe(429);
    expect(e.details.retryAfterMs).toBe(2000);
    expect(e.message).toBe(MESSAGES.en.RATE_LIMITED);
  });

  it('the deprecated UniHubApiError alias satisfies instanceof both ways', () => {
    const e = new UniHubError('UNKNOWN', 500);
    expect(e).toBeInstanceOf(UniHubApiError);
    const legacy = new UniHubApiError('UNKNOWN', 500);
    expect(legacy).toBeInstanceOf(UniHubError);
  });
});
