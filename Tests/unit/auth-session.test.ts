import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UniHubError } from '../../src/errors';
import { KEY, TOKEN, VISITOR, expectNoTokenInUrls, fakeBrowser, res, setup, signInWithPopup, tokenBody } from './fakes';

const STORED = `unihub:session:${KEY}`;
const HOUR = 3600_000;

async function failure(p: Promise<unknown>): Promise<UniHubError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(UniHubError);
    return e as UniHubError;
  }
  throw new Error('expected a rejection');
}

let current: ReturnType<typeof setup> | undefined;
const make = (...args: Parameters<typeof setup>) => (current = setup(...args));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: new Date('2026-11-06T12:00:00Z') });
});
afterEach(() => {
  if (current) expectNoTokenInUrls(current);
  current = undefined;
  vi.useRealTimers();
});

describe('(g) where the session lives', () => {
  it('memory by default: storage is never touched', async () => {
    const t = make();
    t.auth.current();
    t.auth.onChange(() => undefined);
    await signInWithPopup(t);
    t.auth.current();
    expect(t.fb.storageCalls).toEqual([]);
  });

  it.each(['sessionStorage', 'localStorage'] as const)('opt-in %s survives a reload', async (kind) => {
    const t = make({ session: kind });
    await signInWithPopup(t);
    const raw = t.fb.storages[kind].getItem(STORED);
    expect(JSON.parse(raw as string)).toEqual({ token: TOKEN, expiresAt: Date.now() + HOUR, visitor: VISITOR });
    const other = kind === 'sessionStorage' ? 'localStorage' : 'sessionStorage';
    expect(t.fb.storages[other].map.size).toBe(0);

    // Reload: a new instance over the same storage.
    const fb = fakeBrowser();
    fb.storages[kind] = t.fb.storages[kind];
    const r = make({ fb, session: kind });
    expect(r.auth.current()).toEqual(VISITOR);
    r.fetch.mockResolvedValueOnce(res(200, { status: 'JOINED' }));
    await r.attendance.join(5);
    expect((r.fetch.mock.calls[0][1]!.headers as Headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('an expired or corrupt stored entry is deleted and reads as null', () => {
    for (const raw of [
      JSON.stringify({ token: TOKEN, expiresAt: Date.now() - 1, visitor: VISITOR }),
      '{not json',
      JSON.stringify({ token: 'bearer-x', expiresAt: Date.now() + HOUR, visitor: VISITOR }),
      JSON.stringify({ token: TOKEN, expiresAt: Date.now() + HOUR, visitor: { userId: '30' } }),
    ]) {
      const fb = fakeBrowser();
      fb.storages.localStorage.setItem(STORED, raw);
      const t = make({ fb, session: 'localStorage' });
      expect(t.auth.current()).toBeNull();
      expect(fb.storages.localStorage.getItem(STORED)).toBeNull();
    }
  });

  it('storage is read lazily, on the first call, not when created', () => {
    const t = make({ session: 'localStorage' });
    expect(t.fb.storageCalls).toEqual([]);
    t.auth.current();
    expect(t.fb.storageCalls).toEqual(['localStorage']);
  });
});

describe('(h) expiry, fake clock (A2)', () => {
  it('at expiresAt the timer clears the session and fires onChange(null) once', async () => {
    const t = make({ session: 'localStorage' });
    const seen: unknown[] = [];
    t.auth.onChange((v) => seen.push(v));
    await signInWithPopup(t);
    await vi.advanceTimersByTimeAsync(HOUR - 1);
    expect(t.auth.current()).toEqual(VISITOR);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([VISITOR, null]);
    expect(t.auth.current()).toBeNull();
    expect(t.fb.storages.localStorage.getItem(STORED)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a throttled timer: the next current() notices, once', async () => {
    const t = make();
    const seen: unknown[] = [];
    t.auth.onChange((v) => seen.push(v));
    await signInWithPopup(t);
    vi.setSystemTime(Date.now() + HOUR + 5000); // clock moves, timer does not fire
    expect(t.auth.current()).toBeNull();
    expect(t.auth.current()).toBeNull();
    expect(seen).toEqual([VISITOR, null]);
  });

  it('a throttled timer: join rejects NOT_SIGNED_IN without a request', async () => {
    const t = make();
    const seen: unknown[] = [];
    t.auth.onChange((v) => seen.push(v));
    await signInWithPopup(t);
    vi.setSystemTime(Date.now() + HOUR);
    const e = await failure(t.attendance.join(7));
    expect(e.code).toBe('NOT_SIGNED_IN');
    expect(e.status).toBe(0);
    expect(t.fetch).toHaveBeenCalledTimes(1); // the exchange only
    expect(seen).toEqual([VISITOR, null]);
  });

  it('a 401 NOT_SIGNED_IN on join clears the session, fires onChange(null), rethrows', async () => {
    const t = make({ session: 'sessionStorage' });
    const seen: unknown[] = [];
    t.auth.onChange((v) => seen.push(v));
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(401, { code: 'NOT_SIGNED_IN', message: 'Session expired.' }));
    const p = failure(t.attendance.join(7));
    await vi.advanceTimersByTimeAsync(300); // transport pacing
    const e = await p;
    expect(e.code).toBe('NOT_SIGNED_IN');
    expect(e.status).toBe(401);
    expect(seen).toEqual([VISITOR, null]);
    expect(t.auth.current()).toBeNull();
    expect(t.fb.storages.sessionStorage.getItem(STORED)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a 401 for an old token does not clear a newer session', async () => {
    const t = make();
    await signInWithPopup(t);
    const s = t.session.get()!;
    t.session.set({ ...s, token: 'uhct_newer' });
    t.session.clear(TOKEN);
    expect(t.auth.current()).toEqual(VISITOR);
  });
});

describe('(i) signOut', () => {
  it('sends DELETE /session with the token, then clears', async () => {
    const t = make({ session: 'localStorage' });
    const seen: unknown[] = [];
    t.auth.onChange((v) => seen.push(v));
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(204));
    const p = t.auth.signOut();
    await vi.advanceTimersByTimeAsync(300);
    await p;
    const [url, init] = t.fetch.mock.calls[1];
    expect(url).toBe('https://api.example.test/api/v1/community/session');
    expect(init!.method).toBe('DELETE');
    expect((init!.headers as Headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(t.auth.current()).toBeNull();
    expect(seen).toEqual([VISITOR, null]);
    expect(t.fb.storages.localStorage.getItem(STORED)).toBeNull();
  });

  it('clears even when the request fails (NETWORK), and never rejects', async () => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const p = t.auth.signOut();
    await vi.advanceTimersByTimeAsync(300);
    await expect(p).resolves.toBeUndefined();
    expect(t.fetch).toHaveBeenCalledTimes(2); // DELETE is not retried
    expect(t.auth.current()).toBeNull();
  });

  it('signed out already: no request', async () => {
    const t = make();
    await t.auth.signOut();
    expect(t.fetch).not.toHaveBeenCalled();
  });
});

describe('onChange', () => {
  it('fires once per change; unsubscribe works; a throwing listener does not break others', async () => {
    const t = make();
    const a: unknown[] = [];
    const b: unknown[] = [];
    t.auth.onChange(() => {
      throw new Error('site bug');
    });
    const offA = t.auth.onChange((v) => a.push(v));
    t.auth.onChange((v) => b.push(v));
    await signInWithPopup(t);
    offA();
    t.session.clear();
    t.session.clear();
    expect(a).toEqual([VISITOR]);
    expect(b).toEqual([VISITOR, null]);
  });

  it('a second sign-in replaces the session and its timer', async () => {
    const t = make();
    await signInWithPopup(t);
    await vi.advanceTimersByTimeAsync(HOUR / 2);
    await signInWithPopup(t, tokenBody(Date.now() + HOUR));
    await vi.advanceTimersByTimeAsync(HOUR / 2 + 1000);
    expect(t.auth.current()).toEqual(VISITOR);
    expect(vi.getTimerCount()).toBe(1);
  });
});
