import { describe, expect, it } from 'vitest';
import { createUniHub, DEFAULT_BASE_URL, UniHubError, type UniHub } from '../../src/index';
import { createTransport, type RequestOptions } from '../../src/transport';

/*
 * Contract suite, Phase 05: the BK-06 attendance routes, against a real backend, with **no real
 * session** — every call is either signed out (refused locally) or carries a bogus `uhct_`, which
 * the server refuses before any attendance is read or written. Nothing here joins, leaves or
 * applies. Same opt-in variables as events.test.ts, plus UNIHUB_TEST_EVENT: the id of a public
 * event of the key's club (required; no default — see Tests/README.md "Contract fixture").
 */
const KEY = process.env.UNIHUB_TEST_KEY ?? '';
const ORIGIN = process.env.UNIHUB_TEST_ORIGIN ?? 'http://localhost:5173';
const BASE = process.env.UNIHUB_BASE_URL ?? DEFAULT_BASE_URL;
const EVENT = Number(process.env.UNIHUB_TEST_EVENT);
const BOGUS = 'uhct_contract_bogus_session';

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

const ROUTES: Array<[string, Omit<RequestOptions, 'token'>]> = [
  ['status', { method: 'GET' }],
  ['attendance', { method: 'DELETE' }],
  ['ticket', { method: 'GET', noStore: true }],
  ['form', { method: 'GET' }],
  ['apply', { method: 'POST', body: { answers: [] } }],
];

const METHODS: Array<[string, (u: UniHub) => Promise<unknown>]> = [
  ['status', (u) => u.attendance.status(EVENT)],
  ['leave', (u) => u.attendance.leave(EVENT)],
  ['ticket', (u) => u.attendance.ticket(EVENT)],
  ['form', (u) => u.attendance.form(EVENT)],
  ['apply', (u) => u.attendance.apply(EVENT, [])],
];

describe.skipIf(!KEY)(`contract: attendance routes (BK-06) against ${BASE}`, () => {
  it('UNIHUB_TEST_EVENT names an event', () => {
    expect(Number.isSafeInteger(EVENT) && EVENT > 0, 'set UNIHUB_TEST_EVENT to a public event id of the test club').toBe(true);
  });

  it.each([
    ['DELETE', `/events/${EVENT}/attendance`, 'x-community-key,x-sdk-version,authorization'],
    ['GET', `/events/${EVENT}/ticket`, 'x-community-key,x-sdk-version,authorization'],
    ['POST', `/events/${EVENT}/apply`, 'x-community-key,x-sdk-version,authorization,content-type'],
  ])('CORS preflight allows %s %s with %s from the test origin', async (method, path, requested) => {
    const r = await fetch(`${BASE}${path}`, {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': requested },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect((r.headers.get('Access-Control-Allow-Methods') ?? '').toUpperCase()).toContain(method);
    const allowed = (r.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase();
    for (const h of requested.split(',')) expect(allowed).toContain(h);
  });

  it.each(METHODS)('attendance.%s signed out is NOT_SIGNED_IN locally, with no request', async (_name, run) => {
    let calls = 0;
    const counting: typeof fetch = (input, init) => {
      calls++;
      return fetchFrom(ORIGIN)(input, init);
    };
    const e = await failure(run(createUniHub({ key: KEY, baseUrl: BASE, locale: 'en', fetch: counting })));
    expect(e.code).toBe('NOT_SIGNED_IN');
    expect(e.status).toBe(0);
    expect(calls).toBe(0);
  });

  it.each(ROUTES)('/%s with a bogus uhct_ session is refused NOT_SIGNED_IN by the server', async (route, options) => {
    const e = await failure(transport().request(`/events/${EVENT}/${route}`, { ...options, token: BOGUS }));
    expect(e.code).toBe('NOT_SIGNED_IN');
    expect(e.status).toBe(401);
  });

  it('a nonexistent event with a bogus session: records which check runs first', async () => {
    const e = await failure(transport().request('/events/999999999/status', { method: 'GET', token: BOGUS }));
    expect(['NOT_SIGNED_IN', 'EVENT_NOT_FOUND']).toContain(e.code);
    console.info(`[contract] nonexistent event + bogus session → ${e.status} ${e.code}`);
  });
});
