import { afterEach, describe, expect, it } from 'vitest';
import { challengeFor } from '../../src/auth/pkce';
import { UniHubError } from '../../src/errors';
import { KEY, PAGE_ORIGIN, VISITOR, expectNoTokenInUrls, fakeBrowser, fakeCrypto, res, setup, tokenBody } from './fakes';

const PENDING = `unihub:connect:${KEY}`;

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
});

/** Starts a redirect sign-in and returns the /connect URL it navigated to. */
async function start(t: ReturnType<typeof setup>, returnUrl?: string): Promise<URL> {
  let settled = false;
  void t.auth.signIn({ mode: 'redirect', returnUrl }).finally(() => (settled = true));
  for (let i = 0; i < 100 && t.fb.assigned.length === 0; i++) await Promise.resolve();
  expect(settled).toBe(false);
  expect(t.fb.assigned).toHaveLength(1);
  return new URL(t.fb.assigned[0]);
}

/** The browser coming back from /connect: the same storage, a new page. */
function comeBack(t: ReturnType<typeof setup>, query: string) {
  const fb = fakeBrowser({ href: `${PAGE_ORIGIN}/events?page=2&${query}#top` });
  fb.storages.sessionStorage = t.fb.storages.sessionStorage;
  return make({ fb });
}

describe('redirect sign-in', () => {
  it('(f) round trip: out with PKCE in sessionStorage, back with the code, exchanged', async () => {
    const out = make();
    const url = await start(out);
    expect(url.origin + url.pathname).toBe('https://www.unihub.tr/connect');
    expect(url.searchParams.get('mode')).toBe('redirect');
    expect(url.searchParams.get('client')).toBe(KEY);
    expect(url.searchParams.get('origin')).toBe(PAGE_ORIGIN);
    expect(url.searchParams.get('return')).toBe(`${PAGE_ORIGIN}/events?page=2#top`);
    const stored = JSON.parse(out.fb.storages.sessionStorage.getItem(PENDING) as string);
    expect(stored.state).toBe(url.searchParams.get('state'));
    expect(await challengeFor(fakeCrypto, stored.verifier)).toBe(url.searchParams.get('code_challenge'));
    expect(url.toString()).not.toContain(stored.verifier);
    expect(out.fb.opened).toEqual([]);

    const back = comeBack(out, `unihub_code=uhcc_back&state=${stored.state}`);
    back.fetch.mockResolvedValueOnce(res(200, tokenBody()));
    expect(await back.auth.handleRedirect()).toEqual(VISITOR);
    expect(JSON.parse(back.fetch.mock.calls[0][1]!.body as string)).toEqual({ code: 'uhcc_back', codeVerifier: stored.verifier });
    expect(back.auth.current()).toEqual(VISITOR);
    // The PKCE entry is gone.
    expect(back.fb.storages.sessionStorage.getItem(PENDING)).toBeNull();
  });

  it('(f, A1) strips the result from the address bar before the exchange, keeping the rest', async () => {
    const out = make();
    await start(out);
    const state = JSON.parse(out.fb.storages.sessionStorage.getItem(PENDING) as string).state;
    const back = comeBack(out, `unihub_code=uhcc_back&state=${state}`);
    back.fetch.mockResolvedValueOnce(res(200, tokenBody()));
    await back.auth.handleRedirect();
    expect(back.fb.log.indexOf('replaceState')).toBeGreaterThanOrEqual(0);
    expect(back.fb.log.indexOf('replaceState')).toBeLessThan(back.fb.log.indexOf('fetch'));
    expect(back.fb.replaced).toEqual([`${PAGE_ORIGIN}/events?page=2#top`]);
  });

  it('(f) a state mismatch exchanges nothing, still strips, and rejects SIGN_IN_CANCELLED', async () => {
    const out = make();
    await start(out);
    const back = comeBack(out, `unihub_code=uhcc_forged&state=${'Z'.repeat(22)}`);
    expect((await failure(back.auth.handleRedirect())).code).toBe('SIGN_IN_CANCELLED');
    expect(back.fetch).not.toHaveBeenCalled();
    expect(back.fb.replaced).toEqual([`${PAGE_ORIGIN}/events?page=2#top`]);
    expect(back.fb.storages.sessionStorage.getItem(PENDING)).toBeNull();
  });

  it('a code with no stored attempt (another tab, a crafted link) is never exchanged', async () => {
    const t = make({ fb: fakeBrowser({ href: `${PAGE_ORIGIN}/?unihub_code=uhcc_x&state=${'A'.repeat(22)}` }) });
    expect((await failure(t.auth.handleRedirect())).code).toBe('SIGN_IN_CANCELLED');
    expect(t.fetch).not.toHaveBeenCalled();
    expect(t.fb.replaced).toEqual([`${PAGE_ORIGIN}/`]);
  });

  it('unihub_error=CANCELLED rejects SIGN_IN_CANCELLED and strips', async () => {
    const out = make();
    await start(out);
    const state = JSON.parse(out.fb.storages.sessionStorage.getItem(PENDING) as string).state;
    const back = comeBack(out, `unihub_error=CANCELLED&state=${state}`);
    expect((await failure(back.auth.handleRedirect())).code).toBe('SIGN_IN_CANCELLED');
    expect(back.fetch).not.toHaveBeenCalled();
    expect(back.fb.replaced).toEqual([`${PAGE_ORIGIN}/events?page=2#top`]);
  });

  it('no result in the URL: null, no request, no history change', async () => {
    const t = make({ fb: fakeBrowser({ href: `${PAGE_ORIGIN}/events?state=mine` }) });
    expect(await t.auth.handleRedirect()).toBeNull();
    expect(t.fetch).not.toHaveBeenCalled();
    expect(t.fb.replaced).toEqual([]);
  });

  it('(f) a foreign-origin returnUrl is INVALID_ARGUMENT and navigates nowhere', async () => {
    const t = make();
    for (const bad of ['https://evil.example/cb', '//evil.example/cb', 'javascript:alert(1)']) {
      expect((await failure(t.auth.signIn({ mode: 'redirect', returnUrl: bad }))).code).toBe('INVALID_ARGUMENT');
    }
    expect(t.fb.assigned).toEqual([]);
    expect(t.fb.storages.sessionStorage.map.size).toBe(0);
  });

  it('a same-origin relative returnUrl is resolved against the page', async () => {
    const t = make();
    const url = await start(t, '/thanks?x=1');
    expect(url.searchParams.get('return')).toBe(`${PAGE_ORIGIN}/thanks?x=1`);
  });

  it('the default returnUrl drops an old result from the current URL', async () => {
    const t = make({ fb: fakeBrowser({ href: `${PAGE_ORIGIN}/e?unihub_error=CANCELLED&state=old&keep=1` }) });
    const url = await start(t);
    expect(url.searchParams.get('return')).toBe(`${PAGE_ORIGIN}/e?keep=1`);
  });
});
