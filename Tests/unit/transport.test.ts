import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTransport } from '../../src/transport';
import { UniHubError, type UniHubErrorCode } from '../../src/errors';
import { MESSAGES } from '../../src/i18n';
import { SDK_VERSION } from '../../src/version';

const BASE = 'https://api.example.test/api/v1/community';

function mockFetch(...responses: Array<Response | Error>) {
  const fn = vi.fn<typeof fetch>();
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r);
  }
  return fn;
}

function transport(fetchImpl: typeof fetch, locale: 'tr' | 'en' = 'en') {
  return createTransport({ baseUrl: BASE, key: { header: 'X-Community-Key', value: 'uhpk_live_test' }, locale, fetch: fetchImpl });
}

async function failure(p: Promise<unknown>): Promise<UniHubError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(UniHubError);
    return e as UniHubError;
  }
  throw new Error('expected a rejection');
}

describe('request shape', () => {
  it('sends the community key, and Authorization only when a token is given', async () => {
    const f = mockFetch(new Response('{}'), new Response('{}'));
    const t = transport(f);
    await t.request('/events/k', { method: 'GET' });
    await t.request('/events/k/join', { method: 'POST', token: 'tok' });

    const [url1, init1] = f.mock.calls[0];
    expect(url1).toBe(`${BASE}/events/k`);
    const h1 = init1!.headers as Headers;
    expect(h1.get('X-Community-Key')).toBe('uhpk_live_test');
    expect(h1.get('Authorization')).toBeNull();
    // No body, no Content-Type: one header fewer for a CORS preflight to allow.
    expect(h1.get('Content-Type')).toBeNull();

    const h2 = f.mock.calls[1][1]!.headers as Headers;
    expect(h2.get('Authorization')).toBe('Bearer tok');
  });

  it('sends a JSON body with Content-Type', async () => {
    const f = mockFetch(new Response('{}'));
    await transport(f).request('/x', { method: 'POST', body: { a: 1 } });
    const init = f.mock.calls[0][1]!;
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });
});

describe('response bodies', () => {
  it('parses JSON, returns plain text as a string, and an empty body as undefined', async () => {
    const t = transport(mockFetch(new Response('{"id":1}'), new Response('uevk_abc'), new Response('')));
    expect(await t.request('/a', { method: 'GET' })).toEqual({ id: 1 });
    expect(await t.request('/b', { method: 'GET' })).toBe('uevk_abc');
    expect(await t.request('/c', { method: 'GET' })).toBeUndefined();
  });
});

// The backend's code table (hand-off "Phase 20 contract — BK-05", backend 8bddd5a): code, status, a message it sends.
const BACKEND_CODES: Array<[UniHubErrorCode, number, string]> = [
  ['KEY_INVALID', 401, 'Community API Key (X-Community-Key, X-Event-Key or X-Master-Key) is required.'],
  ['RATE_LIMITED', 429, 'Rate Limit Exceeded. Too many requests. Wait a moment.'],
  ['ORIGIN_NOT_ALLOWED', 401, 'Origin not allowed for this Community key.'],
  ['NOT_SIGNED_IN', 401, 'Authentication required.'],
  ['NOT_REGISTERED', 403, 'User not found.'],
  ['EVENT_NOT_FOUND', 404, 'Event not found.'],
  ['FORM_REQUIRED', 409, 'Bu etkinlik başvuru formu gerektiriyor.'],
  ['EMAIL_NOT_VERIFIED', 403, 'Bu etkinliğe katılmak için e-posta adresinizi doğrulamanız gerekiyor.'],
  ['VERIFIED_MEMBERS_ONLY', 403, 'Bu kulübün etkinliklerine katılmak için e-posta adresinizi doğrulamanız gerekiyor.'],
  ['MEMBERS_ONLY', 400, 'Bu etkinliğe katılmak için kulübün onaylı üyesi olmalısınız.'],
  ['EVENT_CLOSED', 400, 'Bu etkinlik için son katılım tarihi geçmiştir.'],
  ['INVALID_ARGUMENT', 400, 'page must be an integer'],
  ['ALREADY_JOINED', 409, 'Bu etkinlik için zaten başvurdunuz.'],
  ['EVENT_FULL', 409, 'Etkinlik dolu.'],
  ['UNKNOWN', 500, 'Internal server error.'],
];

const coded = (code: string, message: string, status: number, headers?: Record<string, string>) =>
  new Response(JSON.stringify({ code, message }), { status, headers });

describe('status → code (BK-05 {code, message} bodies)', () => {
  it.each(BACKEND_CODES)('%s (%i) → that code; message localised; backend text kept', async (code, status, text) => {
    // POST: never retried, so the first answer is the one under test.
    const e = await failure(transport(mockFetch(coded(code, text, status)), 'en').request('/a', { method: 'POST' }));
    expect(e.code).toBe(code);
    expect(e.status).toBe(status);
    expect(e.message).toBe(MESSAGES.en[code]);
    expect(e.details.backendMessage).toBe(text);
    expect(e.details.backendCode).toBeUndefined();
  });

  it('a 429 is RATE_LIMITED whatever its body says, with Retry-After in ms', async () => {
    const e = await failure(
      transport(mockFetch(coded('UNKNOWN', 'x', 429, { 'Retry-After': '1' }))).request('/a', { method: 'POST' })
    );
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.details.retryAfterMs).toBe(1000);
    const e2 = await failure(transport(mockFetch(new Response('', { status: 429 }))).request('/a', { method: 'POST' }));
    expect(e2.details.retryAfterMs).toBeUndefined();
  });

  it('an unknown code → UNKNOWN, the raw code in details.backendCode', async () => {
    const e = await failure(transport(mockFetch(coded('SOMETHING_NEW', 'New refusal.', 409))).request('/a', { method: 'POST' }));
    expect(e.code).toBe('UNKNOWN');
    expect(e.status).toBe(409);
    expect(e.details.backendCode).toBe('SOMETHING_NEW');
    expect(e.details.backendMessage).toBe('New refusal.');
  });

  it('a server cannot claim NETWORK — only the SDK reports that no response arrived', async () => {
    const e = await failure(transport(mockFetch(coded('NETWORK', 'x', 503))).request('/a', { method: 'POST' }));
    expect(e.code).toBe('UNKNOWN');
    expect(e.details.backendCode).toBe('NETWORK');
  });

  it('a non-string code is ignored and the status decides', async () => {
    const body = JSON.stringify({ code: 42, message: 'odd' });
    const e = await failure(transport(mockFetch(new Response(body, { status: 401 }))).request('/a', { method: 'POST' }));
    expect(e.code).toBe('KEY_INVALID');
    expect(e.details.backendCode).toBeUndefined();
  });

  it('reads through the Spring wrapper a key-lookup failure still arrives in', async () => {
    const msg = '401 UNAUTHORIZED "Invalid or inactive Community key."';
    const e = await failure(transport(mockFetch(coded('KEY_INVALID', msg, 401))).request('/a', { method: 'POST' }));
    expect(e.code).toBe('KEY_INVALID');
    expect(e.details.backendMessage).toBe('Invalid or inactive Community key.');
  });

  it('the legacy join refusal ({success, message, code} at 400) → its code', async () => {
    const body = JSON.stringify({ success: 'false', message: 'Bu etkinlik için son katılım tarihi geçmiştir.', code: 'EVENT_CLOSED' });
    const e = await failure(transport(mockFetch(new Response(body, { status: 400 }))).request('/j', { method: 'POST' }));
    expect(e.code).toBe('EVENT_CLOSED');
    expect(e.details.backendMessage).toBe('Bu etkinlik için son katılım tarihi geçmiştir.');
  });
});

describe('status → code (fallback: no usable code)', () => {
  it('a plain-text 401 → KEY_INVALID', async () => {
    const e = await failure(transport(mockFetch(new Response('nope', { status: 401 }))).request('/a', { method: 'POST' }));
    expect(e.code).toBe('KEY_INVALID');
    expect(e.details.backendMessage).toBe('nope');
  });

  it('an HTML 502 from a proxy → UNKNOWN, its text cut to 300 characters', async () => {
    const html = '<html>' + 'x'.repeat(1994) + '</html>';
    const e = await failure(transport(mockFetch(new Response(html, { status: 502 }))).request('/a', { method: 'POST' }));
    expect(e.code).toBe('UNKNOWN');
    expect(e.status).toBe(502);
    expect(e.details.backendMessage).toHaveLength(301);
    expect(e.details.backendMessage!.endsWith('…')).toBe(true);
  });

  it('the old {error} shape is no longer matched by text → UNKNOWN, text kept', async () => {
    const body = JSON.stringify({ error: 'Event not found.' });
    const e = await failure(transport(mockFetch(new Response(body, { status: 404 }))).request('/a', { method: 'POST' }));
    expect(e.code).toBe('UNKNOWN');
    expect(e.details.backendMessage).toBe('Event not found.');
  });

  it('an empty 500 → UNKNOWN, no backend message', async () => {
    const e = await failure(transport(mockFetch(new Response('', { status: 500 }))).request('/a', { method: 'POST' }));
    expect(e.code).toBe('UNKNOWN');
    expect(e.details.backendMessage).toBeUndefined();
  });
});

describe('network failures', () => {
  it('a GET is retried once, then succeeds', async () => {
    const f = mockFetch(new TypeError('fetch failed'), new Response('{"ok":true}'));
    expect(await transport(f).request('/a', { method: 'GET' })).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a GET failing twice → NETWORK with status 0', async () => {
    const f = mockFetch(new TypeError('fetch failed'), new TypeError('fetch failed'));
    const e = await failure(transport(f).request('/a', { method: 'GET' }));
    expect(e.code).toBe('NETWORK');
    expect(e.status).toBe(0);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a POST is never retried — it may have reached the server', async () => {
    const f = mockFetch(new TypeError('fetch failed'), new Response('{}'));
    const e = await failure(transport(f).request('/a', { method: 'POST' }));
    expect(e.code).toBe('NETWORK');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('key header, SDK version, query', () => {
  it('sends the key as X-Community-Key, never X-Event-Key', async () => {
    const f = mockFetch(new Response('{}'));
    await transport(f).request('/events', { method: 'GET' });
    const h = f.mock.calls[0][1]!.headers as Headers;
    expect(h.get('X-Community-Key')).toBe('uhpk_live_test');
    expect(h.get('X-Event-Key')).toBeNull();
  });

  it('sends X-SDK-Version, equal to package.json version', async () => {
    const f = mockFetch(new Response('{}'));
    await transport(f).request('/a', { method: 'GET' });
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string };
    expect(SDK_VERSION).toBe(pkg.version);
    expect((f.mock.calls[0][1]!.headers as Headers).get('X-SDK-Version')).toBe(SDK_VERSION);
  });

  it('encodes the query and leaves out undefined entries', async () => {
    const f = mockFetch(new Response('{}'), new Response('{}'));
    const t = transport(f);
    await t.request('/events', { method: 'GET', query: { when: 'past', page: 0, size: undefined } });
    await t.request('/events', { method: 'GET', query: { size: undefined } });
    expect(f.mock.calls[0][0]).toBe(`${BASE}/events?when=past&page=0`);
    expect(f.mock.calls[1][0]).toBe(`${BASE}/events`);
  });
});

describe('rate limit (backend: one request per 200 ms per key and IP, no Retry-After)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Records when each fetch started, relative to the test's start, under fake timers. */
  function timed(...responses: Response[]) {
    vi.useFakeTimers();
    const t0 = Date.now();
    const starts: number[] = [];
    const f = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now() - t0);
      const r = responses.shift();
      if (!r) throw new Error('no more responses');
      return r;
    });
    return { f, starts };
  }

  it('runs parallel requests one at a time, each 210 ms after the previous response; the first goes at once', async () => {
    const { f, starts } = timed(new Response('{}'), new Response('{}'), new Response('{}'));
    const t = transport(f);
    const all = Promise.all(['/a', '/b', '/c'].map((p) => t.request(p, { method: 'GET' })));
    await vi.advanceTimersByTimeAsync(1000);
    await all;
    expect(starts).toEqual([0, 210, 420]);
  });

  it('counts the gap from the response, not the start, so a slow response cannot squeeze the next arrival', async () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    const starts: number[] = [];
    // Every response takes 100 ms (a cold TLS connection, say).
    const f = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now() - t0);
      await new Promise((r) => setTimeout(r, 100));
      return new Response('{}');
    });
    const t = transport(f);
    const all = Promise.all(['/a', '/b', '/c'].map((p) => t.request(p, { method: 'GET' })));
    await vi.advanceTimersByTimeAsync(2000);
    await all;
    expect(starts).toEqual([0, 310, 620]);
  });

  it('a failed request still holds the gap for the next one', async () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    const starts: number[] = [];
    const f = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now() - t0);
      if (starts.length === 1) throw new TypeError('fetch failed');
      return new Response('{}');
    });
    const t = transport(f);
    const post = t.request('/a', { method: 'POST' }).catch((e: unknown) => e);
    const get = t.request('/b', { method: 'GET' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(((await post) as UniHubError).code).toBe('NETWORK');
    await get;
    expect(starts).toEqual([0, 210]);
  });

  it('a GET refused with 429 is retried once after 250 ms', async () => {
    const { f, starts } = timed(new Response('Rate Limit Exceeded.', { status: 429 }), new Response('{"ok":true}'));
    const p = transport(f).request('/a', { method: 'GET' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual({ ok: true });
    expect(starts).toEqual([0, 250]);
  });

  it('a second 429 rejects RATE_LIMITED', async () => {
    const { f } = timed(new Response('', { status: 429 }), new Response('', { status: 429 }));
    const p = failure(transport(f).request('/a', { method: 'GET' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).code).toBe('RATE_LIMITED');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('honours Retry-After, capped at 2 s', async () => {
    const one = timed(new Response('', { status: 429, headers: { 'Retry-After': '1' } }), new Response('{}'));
    const p1 = transport(one.f).request('/a', { method: 'GET' });
    await vi.advanceTimersByTimeAsync(3000);
    await p1;
    expect(one.starts).toEqual([0, 1000]);
    vi.useRealTimers();

    const ten = timed(new Response('', { status: 429, headers: { 'Retry-After': '10' } }), new Response('{}'));
    const p2 = transport(ten.f).request('/a', { method: 'GET' });
    await vi.advanceTimersByTimeAsync(3000);
    await p2;
    expect(ten.starts).toEqual([0, 2000]);
  });

  it('a POST refused with 429 is not retried', async () => {
    const { f } = timed(new Response('', { status: 429 }), new Response('{}'));
    const p = failure(transport(f).request('/a', { method: 'POST' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).code).toBe('RATE_LIMITED');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE (Phase 04: sign-out)', () => {
  it('sends DELETE with the token, is paced, and is not retried on NETWORK', async () => {
    vi.useFakeTimers();
    try {
      const f = mockFetch(new Response('{}'), new TypeError('Failed to fetch'), new Response(null, { status: 204 }));
      const t = transport(f, 'en');
      await t.request('/a', { method: 'GET' });
      const p = failure(t.request('/session', { method: 'DELETE', token: 'uhct_x' }));
      await vi.advanceTimersByTimeAsync(209);
      expect(f).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await p).code).toBe('NETWORK');
      expect(f).toHaveBeenCalledTimes(2);
      const [, init] = f.mock.calls[1];
      expect(init!.method).toBe('DELETE');
      expect((init!.headers as Headers).get('Authorization')).toBe('Bearer uhct_x');
      const ok = t.request('/session', { method: 'DELETE', token: 'uhct_x' });
      await vi.advanceTimersByTimeAsync(210);
      await expect(ok).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('noStore (Phase 05: ticket)', () => {
  it("sets cache: 'no-store' only when asked", async () => {
    const f = mockFetch(new Response('{}'), new Response('{}'));
    const t = transport(f, 'en');
    await t.request('/a', { method: 'GET', noStore: true });
    await t.request('/b', { method: 'GET' });
    expect(f.mock.calls[0][1]!.cache).toBe('no-store');
    expect(f.mock.calls[1][1]!.cache).toBeUndefined();
  });
});

describe('boundary rule 2 (DBL/DependencyMaps/sdk-modules.md)', () => {
  it('only src/transport.ts calls fetch', () => {
    const dir = join(__dirname, '..', '..', 'src');
    const callers = (readdirSync(dir, { recursive: true }) as string[])
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => f.endsWith('.ts'))
      // A direct call `fetch(` or a reach for the global (`globalThis.fetch`, `window.fetch`);
      // a `typeof fetch` type annotation is not a call.
      .filter((f) =>
        /(?<![\w.])fetch\s*\(|\b(?:globalThis|window|self)\.fetch\b/.test(
          readFileSync(join(dir, f), 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')
        )
      );
    expect(callers).toEqual(['transport.ts']);
    // The scan reaches subdirectories (Phase 04: src/auth/).
    expect((readdirSync(dir, { recursive: true }) as string[]).map((f) => f.replace(/\\/g, '/'))).toContain('auth/connect.ts');
  });
});
