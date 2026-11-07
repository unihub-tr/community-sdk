import { describe, expect, it } from 'vitest';
import { createUniHub, DEFAULT_BASE_URL, UniHubError } from '../../src/index';
import { createTransport } from '../../src/transport';

/*
 * Contract suite, Phase 04: the sign-in endpoints the SDK calls, against a real backend, with
 * no sign-in (a real session needs a person at /connect — that is the manual run, plan §4).
 * Same opt-in variables as events.test.ts. Never joins an event: join is tested signed out only.
 */
const KEY = process.env.UNIHUB_TEST_KEY ?? '';
const ORIGIN = process.env.UNIHUB_TEST_ORIGIN ?? 'http://localhost:5173';
const BASE = process.env.UNIHUB_BASE_URL ?? DEFAULT_BASE_URL;

const fetchFrom =
  (origin: string): typeof fetch =>
  (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Origin', origin);
    return fetch(input, { ...init, headers });
  };

/** One transport for the file, so its pacing spaces every request (200 ms per key + IP). */
let shared: ReturnType<typeof createTransport> | undefined;
const transport = () =>
  (shared ??= createTransport({ baseUrl: BASE, key: { header: 'X-Community-Key', value: KEY }, locale: 'en', fetch: fetchFrom(ORIGIN) }));

async function failure(p: Promise<unknown>): Promise<UniHubError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(UniHubError);
    return e as UniHubError;
  }
  throw new Error('expected a rejection');
}

describe.skipIf(!KEY)(`contract: sign-in endpoints against ${BASE}`, () => {
  it.each([
    ['POST', '/connect/token', 'x-community-key,x-sdk-version,content-type'],
    ['POST', '/events/1/join', 'x-community-key,x-sdk-version,authorization'],
    ['DELETE', '/session', 'x-community-key,x-sdk-version,authorization'],
  ])('CORS preflight allows %s %s with %s from the test origin', async (method, path, requested) => {
    const r = await fetch(`${BASE}${path}`, {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': requested },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const methods = (r.headers.get('Access-Control-Allow-Methods') ?? '').toUpperCase();
    expect(methods).toContain(method);
    const allowed = (r.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase();
    for (const h of requested.split(',')) expect(allowed).toContain(h);
  });

  it('a bogus connect code is 400 INVALID_ARGUMENT', async () => {
    const e = await failure(
      transport().request('/connect/token', {
        method: 'POST',
        body: { code: 'uhcc_contract_bogus_code', codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk' },
      })
    );
    expect(e.code).toBe('INVALID_ARGUMENT');
    expect(e.status).toBe(400);
  });

  it('GET /me without a session is 401 NOT_SIGNED_IN', async () => {
    const e = await failure(transport().request('/me', { method: 'GET' }));
    expect(e.code).toBe('NOT_SIGNED_IN');
    expect(e.status).toBe(401);
  });

  it('a bogus uhct_ session is refused NOT_SIGNED_IN by the server', async () => {
    const e = await failure(transport().request('/me', { method: 'GET', token: 'uhct_contract_bogus_session' }));
    expect(e.code).toBe('NOT_SIGNED_IN');
    expect(e.status).toBe(401);
  });

  it('attendance.join signed out is NOT_SIGNED_IN locally, with no request', async () => {
    let calls = 0;
    const counting: typeof fetch = (input, init) => {
      calls++;
      return fetchFrom(ORIGIN)(input, init);
    };
    const unihub = createUniHub({ key: KEY, baseUrl: BASE, locale: 'en', fetch: counting });
    const e = await failure(unihub.attendance.join(1));
    expect(e.code).toBe('NOT_SIGNED_IN');
    expect(e.status).toBe(0);
    expect(calls).toBe(0);
  });
});
