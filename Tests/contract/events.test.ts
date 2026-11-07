import { beforeAll, describe, expect, it } from 'vitest';
import { createUniHub, DEFAULT_BASE_URL, SDK_VERSION, UniHubError, type EventSummary, type UniHub } from '../../src/index';

/*
 * Contract suite: the SDK against a real backend. Opt-in, and never part of `npm test`:
 *   UNIHUB_TEST_KEY     publishable key (uhpk_…) — the suite is skipped without it
 *   UNIHUB_TEST_ORIGIN  an origin the key allows (default http://localhost:5173)
 *   UNIHUB_BASE_URL     default production
 * Needs at least one public event (upcoming or past) in the key's club, and that event must stay:
 * deleting it, or making it private, breaks the suite (2026-10-28, event 98). Date it well ahead —
 * once it has ended it still counts, through the past list.
 */
const KEY = process.env.UNIHUB_TEST_KEY ?? '';
const ORIGIN = process.env.UNIHUB_TEST_ORIGIN ?? 'http://localhost:5173';
const BASE = process.env.UNIHUB_BASE_URL ?? DEFAULT_BASE_URL;

/** Node's fetch sends no Origin; a browser always does, and the key is checked against it. */
const fetchFrom =
  (origin: string): typeof fetch =>
  (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Origin', origin);
    return fetch(input, { ...init, headers });
  };

const unihub = () => createUniHub({ key: KEY, baseUrl: BASE, locale: 'en', fetch: fetchFrom(ORIGIN) });

function expectSummary(e: EventSummary) {
  expect(Number.isInteger(e.id)).toBe(true);
  expect(typeof e.title).toBe('string');
  expect(['UPCOMING', 'PAST']).toContain(e.status);
  for (const t of [e.startsAt, e.registrationDeadline]) {
    if (t !== null) expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/);
  }
}

describe.skipIf(!KEY)(`contract: events against ${BASE}`, () => {
  // Built in beforeAll: a skipped describe still runs its body while collecting.
  let sdk: UniHub;
  let upcoming: EventSummary[] = [];
  let past: EventSummary[] = [];
  /** The event the detail and parallel checks read: the first upcoming one, else the first past one. */
  const first = () => upcoming[0] ?? past[0];
  beforeAll(() => {
    sdk = unihub();
  });

  it('CORS preflight allows the SDK headers from the test origin', async () => {
    const r = await fetch(`${BASE}/events`, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-community-key,x-sdk-version',
      },
    });
    expect(r.status).toBe(200);
    const allowed = (r.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase();
    expect(allowed).toContain('x-community-key');
    expect(allowed).toContain('x-sdk-version');
    console.info(`server Date: ${r.headers.get('Date')}; SDK ${SDK_VERSION}`);
  });

  it('lists upcoming public events in the page shape (zero is allowed)', async () => {
    const page = await sdk.events.list();
    expect(page.page).toBe(0);
    expect(page.totalItems).toBeGreaterThanOrEqual(page.items.length);
    page.items.forEach(expectSummary);
    expect(page.items.every((e) => e.status === 'UPCOMING')).toBe(true);
    upcoming = page.items;
  });

  it('lists past events in the same page shape', async () => {
    const page = await sdk.events.list({ when: 'past', size: 5 });
    expect(page.size).toBe(5);
    page.items.forEach(expectSummary);
    expect(page.items.every((e) => e.status === 'PAST')).toBe(true);
    past = page.items;
  });

  it('the club has at least one public event, upcoming or past', () => {
    expect(first(), 'no public event in this key’s club — create one (see the header comment)').toBeDefined();
  });

  it('gets the first listed event as an EventDetail', async () => {
    const e = first();
    expect(e).toBeDefined();
    const detail = await sdk.events.get(e!.id);
    expectSummary(detail);
    expect(detail).toMatchObject({ id: e!.id, title: e!.title, startsAt: e!.startsAt });
    expect(typeof detail.description).toBe('string');
    expect(detail.capacity).toBeNull();
    for (const flag of [detail.requiresForm, detail.membersOnly, detail.verifiedOnly, detail.approvalRequired]) {
      expect(typeof flag).toBe('boolean');
    }
  });

  it('an id outside the club is EVENT_NOT_FOUND', async () => {
    const e = await sdk.events.get(999_999_999).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UniHubError);
    expect((e as UniHubError).code).toBe('EVENT_NOT_FOUND');
    expect((e as UniHubError).status).toBe(404);
  });

  it('a refusal body is {code, message} with no legacy error key (BK-05)', async () => {
    // A raw fetch has no SDK pacing: wait out the backend's 200 ms window after the previous request.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const r = await fetchFrom(ORIGIN)(`${BASE}/events/999999999`, { headers: { 'X-Community-Key': KEY } });
    expect(r.status).toBe(404);
    const body = (await r.json()) as Record<string, unknown>;
    expect(typeof body.code).toBe('string');
    expect(typeof body.message).toBe('string');
    expect(body).not.toHaveProperty('error');
  });

  it('a well-formed key the backend does not know is KEY_INVALID', async () => {
    const unknown = createUniHub({ key: `uhpk_live_${'0'.repeat(32)}`, baseUrl: BASE, fetch: fetchFrom(ORIGIN) });
    const e = await unknown.events.list().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UniHubError);
    expect((e as UniHubError).code).toBe('KEY_INVALID');
    expect((e as UniHubError).status).toBe(401);
  });

  it('an origin the key does not allow is ORIGIN_NOT_ALLOWED', async () => {
    const foreign = createUniHub({ key: KEY, baseUrl: BASE, fetch: fetchFrom('https://not-allowed.example') });
    const e = await foreign.events.list().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UniHubError);
    expect((e as UniHubError).code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('three parallel reads from one page all resolve (no RATE_LIMITED)', async () => {
    const results = await Promise.all([sdk.events.list(), sdk.events.list({ when: 'past' }), sdk.events.get(first()!.id)]);
    expect(results).toHaveLength(3);
  });
});
