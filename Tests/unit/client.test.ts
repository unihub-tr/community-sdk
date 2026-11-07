import { describe, expect, it, vi } from 'vitest';
import * as sdk from '../../src/index';
import { DEFAULT_BASE_URL } from '../../src/client';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('public surface', () => {
  it('keeps UniHubApiError as an alias of UniHubError, and no longer exports the legacy client (Phase 06 D2)', () => {
    expect(typeof sdk.UniHubApiError).toBe('function');
    for (const legacy of ['UniHubClient', 'JoinResponse']) expect(Object.keys(sdk)).not.toContain(legacy);
    expect(sdk.UniHubApiError).toBe(sdk.UniHubError);
  });

  it('exports createUniHub and SDK_VERSION, and keeps internal modules private (rule 6)', () => {
    expect(typeof sdk.createUniHub).toBe('function');
    expect(typeof sdk.SDK_VERSION).toBe('string');
    const names = Object.keys(sdk);
    for (const internal of [
      'createEvents',
      'createTransport',
      'unwrapBackendMessage',
      'createAuth',
      'createAttendance',
      'createSessionStore',
      'browserEnv',
      'popupCode',
      'redirectStart',
      'redirectFinish',
      'createPkce',
      'challengeFor',
      'CONNECT_URL',
      'CONNECT_ORIGIN',
    ]) {
      expect(names).not.toContain(internal);
    }
  });
});

describe('createUniHub', () => {
  it('returns events, auth and attendance', () => {
    const unihub = sdk.createUniHub({ key: 'uhpk_live_abc', fetch: vi.fn<typeof fetch>() });
    expect(Object.keys(unihub).sort()).toEqual(['attendance', 'auth', 'events']);
    expect(Object.keys(unihub.auth).sort()).toEqual(['current', 'handleRedirect', 'onChange', 'register', 'signIn', 'signOut']);
    expect(Object.keys(unihub.attendance).sort()).toEqual(['apply', 'form', 'join', 'leave', 'status', 'ticket']);
    expect(unihub.auth.current()).toBeNull();
  });

  it.each([['memory'], ['sessionStorage'], ['localStorage'], [undefined]])('session %j is accepted', (session) => {
    expect(() => sdk.createUniHub({ key: 'uhpk_live_abc', session: session as never, fetch: vi.fn<typeof fetch>() })).not.toThrow();
  });

  it.each([['cookie'], ['local'], [''], [true]])('session %j is INVALID_ARGUMENT', (session) => {
    expect(() => sdk.createUniHub({ key: 'uhpk_live_abc', session: session as never })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
  });

  const page = { items: [], page: 0, size: 20, totalItems: 0, totalPages: 0 };

  it('sends the publishable key as X-Community-Key, never X-Event-Key, to production by default', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json(page));
    const unihub = sdk.createUniHub({ key: 'uhpk_live_abc', fetch: fetchImpl });
    await unihub.events.list();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${DEFAULT_BASE_URL}/events?when=upcoming`);
    const h = init!.headers as Headers;
    expect(h.get('X-Community-Key')).toBe('uhpk_live_abc');
    expect(h.get('X-Event-Key')).toBeNull();
    expect(h.get('Authorization')).toBeNull();
  });

  it.each([[''], ['uevk_event_key'], ['mk_master_secret']])('key %j is INVALID_ARGUMENT, before any request', (key) => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(() => sdk.createUniHub({ key, fetch: fetchImpl })).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('defaults to the production API', () => {
    expect(DEFAULT_BASE_URL).toBe('https://api.unihub.tr/api/v1/community');
  });

  it('refuses plain http except for localhost, and a non-URL', () => {
    const k = 'uhpk_live_abc';
    expect(() => sdk.createUniHub({ key: k, baseUrl: 'http://api.unihub.tr/x' })).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => sdk.createUniHub({ key: k, baseUrl: 'not a url' })).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => sdk.createUniHub({ key: k, baseUrl: 'http://localhost:8080/api/v1/community' })).not.toThrow();
    expect(() => sdk.createUniHub({ key: k, baseUrl: 'http://127.0.0.1:8080/api/v1/community/' })).not.toThrow();
  });
});
