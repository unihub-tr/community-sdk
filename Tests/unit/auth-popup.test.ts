import { afterEach, describe, expect, it, vi } from 'vitest';
import { challengeFor } from '../../src/auth/pkce';
import { UniHubError } from '../../src/errors';
import {
  CONNECT_ORIGIN,
  KEY,
  PAGE_ORIGIN,
  TOKEN,
  VISITOR,
  connectMessage,
  connectUrlOf,
  expectNoTokenInUrls,
  fakeBrowser,
  fakeCrypto,
  flush,
  res,
  setup,
  signInWithPopup,
  tokenBody,
} from './fakes';

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

afterEach(() => {
  if (current) expectNoTokenInUrls(current);
  current = undefined;
  vi.useRealTimers();
});

describe('popup sign-in', () => {
  it('opens /connect with the key, the page origin, state and S256 challenge, and no token or verifier', async () => {
    const t = make();
    const { visitor, url } = await signInWithPopup(t);
    expect(visitor).toEqual(VISITOR);
    expect(t.fb.opened).toEqual(['']);
    expect(url.origin + url.pathname).toBe('https://www.unihub.tr/connect');
    expect(url.searchParams.get('client')).toBe(KEY);
    expect(url.searchParams.get('origin')).toBe(PAGE_ORIGIN);
    expect(url.searchParams.get('mode')).toBe('popup');
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.has('return')).toBe(false);
    expect(t.auth.current()).toEqual(VISITOR);
  });

  it('(b) exchanges the code with the verifier that hashes to the challenge', async () => {
    const t = make();
    const { url } = await signInWithPopup(t);
    const [fetchUrl, init] = t.fetch.mock.calls[0];
    expect(fetchUrl).toBe('https://api.example.test/api/v1/community/connect/token');
    expect(init!.method).toBe('POST');
    const body = JSON.parse(init!.body as string) as { code: string; codeVerifier: string };
    expect(body.code).toBe('uhcc_one_time');
    expect(await challengeFor(fakeCrypto, body.codeVerifier)).toBe(url.searchParams.get('code_challenge'));
    expect(url.toString()).not.toContain(body.codeVerifier);
    expect((init!.headers as Headers).get('Authorization')).toBeNull();
  });

  it('(a) ignores every message but the exact origin, source, type and state', async () => {
    const t = make();
    t.fetch.mockResolvedValueOnce(res(200, tokenBody()));
    let settled = false;
    const p = t.auth.signIn().finally(() => (settled = true));
    const popup = t.fb.popups[0];
    const state = (await connectUrlOf(popup)).searchParams.get('state') as string;
    const good = connectMessage(popup, state, { code: 'uhcc_x' });
    const bad = [
      { ...good, origin: 'https://unihub.tr' },
      { ...good, origin: 'http://www.unihub.tr' },
      { ...good, origin: 'https://www.unihub.tr.evil.example' },
      { ...good, origin: 'null' },
      { ...good, source: {} },
      { ...good, source: null },
      { ...good, data: { ...(good.data as object), type: 'other' } },
      { ...good, data: { ...(good.data as object), state: 'A'.repeat(22) } },
      { ...good, data: null },
      { ...good, data: 'unihub:connect' },
    ];
    for (const m of bad) t.fb.send(m);
    await flush();
    expect(settled).toBe(false);
    expect(t.fetch).not.toHaveBeenCalled();
    t.fb.send(good);
    expect(await p).toEqual(VISITOR);
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });

  it('(c) a cancel from /connect rejects SIGN_IN_CANCELLED and sends nothing', async () => {
    const t = make();
    const p = t.auth.signIn();
    const popup = t.fb.popups[0];
    const state = (await connectUrlOf(popup)).searchParams.get('state') as string;
    t.fb.send(connectMessage(popup, state, { error: 'CANCELLED' }));
    const e = await failure(p);
    expect(e.code).toBe('SIGN_IN_CANCELLED');
    expect(e.status).toBe(0);
    expect(t.fetch).not.toHaveBeenCalled();
    expect(t.fb.listeners.size).toBe(0);
    expect(t.auth.current()).toBeNull();
  });

  it('(c) a blocked popup rejects POPUP_BLOCKED', async () => {
    const t = make({ fb: fakeBrowser({ block: true }) });
    expect((await failure(t.auth.signIn())).code).toBe('POPUP_BLOCKED');
    expect(t.fb.listeners.size).toBe(0);
  });

  it('(d) opens the popup synchronously, before any await (crypto never resolves)', () => {
    const stuck = {
      getRandomValues: fakeCrypto.getRandomValues,
      subtle: { digest: () => new Promise<ArrayBuffer>(() => undefined) },
    };
    const t = make({ fb: fakeBrowser({ crypto: stuck }) });
    void t.auth.signIn();
    // No await has run yet: the popup is already open.
    expect(t.fb.log[0]).toBe('open');
    expect(t.fb.popups).toHaveLength(1);
    expect(t.fb.popups[0].hrefs).toEqual([]);
  });

  it('without Web Crypto rejects INVALID_ARGUMENT and opens nothing', async () => {
    const t = make({ fb: fakeBrowser({ crypto: null }) });
    expect((await failure(t.auth.signIn())).code).toBe('INVALID_ARGUMENT');
    expect(t.fb.opened).toEqual([]);
  });

  it('an unknown mode is INVALID_ARGUMENT', async () => {
    const t = make();
    expect((await failure(t.auth.signIn({ mode: 'iframe' as never }))).code).toBe('INVALID_ARGUMENT');
    expect(t.fb.opened).toEqual([]);
  });

  it('(e) a second signIn while the popup is open focuses it and returns the same promise', async () => {
    const t = make();
    t.fetch.mockResolvedValueOnce(res(200, tokenBody()));
    const p1 = t.auth.signIn();
    const p2 = t.auth.signIn();
    const p3 = t.auth.register();
    expect(p2).toBe(p1);
    expect(p3).toBe(p1);
    expect(t.fb.opened).toHaveLength(1);
    expect(t.fb.popups[0].focus).toHaveBeenCalledTimes(2);
    const popup = t.fb.popups[0];
    const state = (await connectUrlOf(popup)).searchParams.get('state') as string;
    t.fb.send(connectMessage(popup, state, { code: 'uhcc_x' }));
    expect(await p1).toEqual(VISITOR);

    // Settled: the next signIn opens a new popup.
    t.fetch.mockResolvedValueOnce(res(200, tokenBody()));
    const p4 = t.auth.signIn();
    expect(p4).not.toBe(p1);
    expect(t.fb.opened).toHaveLength(2);
    const second = t.fb.popups[1];
    t.fb.send(connectMessage(second, (await connectUrlOf(second)).searchParams.get('state') as string, { code: 'uhcc_y' }));
    await p4;
  });

  it('(e2) closing the popup rejects SIGN_IN_CANCELLED within one poll, and cleans up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const t = make();
    const p = failure(t.auth.signIn());
    const popup = t.fb.popups[0];
    await connectUrlOf(popup);
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.fb.listeners.size).toBe(1);
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(500);
    expect((await p).code).toBe('SIGN_IN_CANCELLED');
    expect(t.fb.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it('after a success the listener and the poll are gone', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const t = make();
    await signInWithPopup(t);
    expect(t.fb.listeners.size).toBe(0);
    // Only the session's expiry timer remains.
    expect(vi.getTimerCount()).toBe(1);
  });

  it('a refused exchange rejects with the backend code and stores nothing', async () => {
    const t = make();
    t.fetch.mockResolvedValueOnce(res(400, { code: 'INVALID_ARGUMENT', message: 'Invalid or expired connect code.' }));
    const p = t.auth.signIn();
    const popup = t.fb.popups[0];
    t.fb.send(connectMessage(popup, (await connectUrlOf(popup)).searchParams.get('state') as string, { code: 'uhcc_x' }));
    const e = await failure(p);
    expect(e.code).toBe('INVALID_ARGUMENT');
    expect(e.status).toBe(400);
    expect(t.auth.current()).toBeNull();
  });

  it('a malformed token response is UNKNOWN', async () => {
    const t = make();
    const e = await failure(signInWithPopup(t, { token: 'not-a-session', expiresAt: 'x', visitor: VISITOR }));
    expect(e.code).toBe('UNKNOWN');
    expect(t.auth.current()).toBeNull();
  });

  it('the token never reaches the visitor object or a listener', async () => {
    const t = make();
    const seen: unknown[] = [];
    t.auth.onChange((v) => seen.push(v));
    const { visitor } = await signInWithPopup(t);
    expect(JSON.stringify([visitor, seen, t.auth.current()])).not.toContain(TOKEN);
    expect(seen).toEqual([VISITOR]);
    expect(CONNECT_ORIGIN).toBe('https://www.unihub.tr');
  });
});
