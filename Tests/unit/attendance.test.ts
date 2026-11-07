import { afterEach, describe, expect, it } from 'vitest';
import { UniHubError, type UniHubErrorCode } from '../../src/errors';
import type { FormAnswer } from '../../src/types';
import { TOKEN, expectNoTokenInUrls, res, setup, signInWithPopup } from './fakes';

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

describe('attendance.join', () => {
  it('not signed in: NOT_SIGNED_IN, no request', async () => {
    const t = make();
    const e = await failure(t.attendance.join(102));
    expect(e.code).toBe('NOT_SIGNED_IN');
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN, '102' as unknown as number])('eventId %j is INVALID_ARGUMENT, no request', async (id) => {
    const t = make();
    expect((await failure(t.attendance.join(id))).code).toBe('INVALID_ARGUMENT');
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it.each(['JOINED', 'PENDING_APPROVAL', 'ALREADY_JOINED'])('returns status %s', async (status) => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(200, { status }));
    expect(await t.attendance.join(102)).toEqual({ status });
    const [url, init] = t.fetch.mock.calls[1];
    expect(url).toBe('https://api.example.test/api/v1/community/events/102/join');
    expect(init!.method).toBe('POST');
    expect((init!.headers as Headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('an unknown status is UNKNOWN with the status kept', async () => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(200, { status: 'WAITLISTED' }));
    const e = await failure(t.attendance.join(102));
    expect(e.code).toBe('UNKNOWN');
    expect(e.details.backendMessage).toBe('WAITLISTED');
  });

  it.each<[UniHubErrorCode, number]>([
    ['EMAIL_NOT_VERIFIED', 403],
    ['VERIFIED_MEMBERS_ONLY', 403],
    ['MEMBERS_ONLY', 403],
    ['EVENT_FULL', 409],
    ['EVENT_CLOSED', 409],
    ['EVENT_NOT_FOUND', 404],
    ['FORM_REQUIRED', 409],
    ['NOT_REGISTERED', 403],
  ])('passes %s through and keeps the session', async (code, status) => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(status, { code, message: 'm' }));
    const e = await failure(t.attendance.join(102));
    expect(e.code).toBe(code);
    expect(e.status).toBe(status);
    expect(t.auth.current()).not.toBeNull();
  });

  it('a POST is not retried on NETWORK (it may have reached the server)', async () => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect((await failure(t.attendance.join(102))).code).toBe('NETWORK');
    expect(t.fetch).toHaveBeenCalledTimes(2);
    expect(t.auth.current()).not.toBeNull();
  });
});

// ---- Phase 05: status, leave, ticket, form, apply (BK-06) ----

const PAYLOAD = 'a3f1c2d4-5b6e-4f70-8a9b-0c1d2e3f4a5b';
type T = ReturnType<typeof setup>;
const CALLS: Array<[string, (t: T, id: number) => Promise<unknown>, string, string]> = [
  ['status', (t, id) => t.attendance.status(id), 'GET', 'status'],
  ['leave', (t, id) => t.attendance.leave(id), 'DELETE', 'attendance'],
  ['ticket', (t, id) => t.attendance.ticket(id), 'GET', 'ticket'],
  ['form', (t, id) => t.attendance.form(id), 'GET', 'form'],
  ['apply', (t, id) => t.attendance.apply(id, []), 'POST', 'apply'],
];

describe.each(CALLS)('attendance.%s — session rule (b)', (_name, run, method, route) => {
  it('not signed in: NOT_SIGNED_IN, no request', async () => {
    const t = make();
    expect((await failure(run(t, 102))).code).toBe('NOT_SIGNED_IN');
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it.each([0, -3, 2.5, NaN])('eventId %j is INVALID_ARGUMENT, no request', async (id) => {
    const t = make();
    await signInWithPopup(t);
    expect((await failure(run(t, id))).code).toBe('INVALID_ARGUMENT');
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });

  it('a server NOT_SIGNED_IN clears the session once and rethrows', async () => {
    const t = make();
    await signInWithPopup(t);
    const changes: unknown[] = [];
    t.auth.onChange((v) => changes.push(v));
    t.fetch.mockResolvedValueOnce(res(401, { code: 'NOT_SIGNED_IN', message: 'Authentication required.' }));
    expect((await failure(run(t, 102))).code).toBe('NOT_SIGNED_IN');
    expect(t.auth.current()).toBeNull();
    expect(changes).toEqual([null]);
  });

  it(`sends ${method} /events/{id}/${route} with the session`, async () => {
    const t = make();
    await signInWithPopup(t);
    const ok: Record<string, Response> = {
      status: res(200, { status: 'JOINED' }),
      attendance: res(204),
      ticket: res(200, { qrPayload: PAYLOAD }),
      form: res(200, { questions: [], appRequired: false }),
      apply: res(200, { status: 'JOINED' }),
    };
    t.fetch.mockResolvedValueOnce(ok[route]);
    await run(t, 102);
    const [url, init] = t.fetch.mock.calls[1];
    expect(url).toBe(`https://api.example.test/api/v1/community/events/102/${route}`);
    expect(init!.method).toBe(method);
    expect((init!.headers as Headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });
});

describe('attendance.status (c)', () => {
  it.each(['NOT_JOINED', 'PENDING_APPROVAL', 'JOINED'])('returns %s', async (status) => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(200, { status }));
    expect(await t.attendance.status(102)).toEqual({ status });
  });

  it('an unknown status is UNKNOWN with the status kept', async () => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(200, { status: 'WAITLISTED' }));
    const e = await failure(t.attendance.status(102));
    expect(e.code).toBe('UNKNOWN');
    expect(e.details.backendMessage).toBe('WAITLISTED');
  });

  it('EVENT_NOT_FOUND passes through and keeps the session', async () => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(404, { code: 'EVENT_NOT_FOUND', message: 'Event not found.' }));
    expect((await failure(t.attendance.status(102))).code).toBe('EVENT_NOT_FOUND');
    expect(t.auth.current()).not.toBeNull();
  });
});

describe('attendance.leave (d)', () => {
  it('204 resolves undefined', async () => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(204));
    await expect(t.attendance.leave(102)).resolves.toBeUndefined();
  });
});

describe('attendance.ticket (e): never logged, stored or cached', () => {
  it('returns exactly { qrPayload }, fetched with cache: no-store', async () => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(200, { qrPayload: PAYLOAD }));
    const ticket = await t.attendance.ticket(102);
    expect(ticket).toEqual({ qrPayload: PAYLOAD });
    expect(Object.keys(ticket)).toEqual(['qrPayload']);
    expect(t.fetch.mock.calls[1][1]!.cache).toBe('no-store');
  });

  it('two calls make two requests and return two distinct objects', async () => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(200, { qrPayload: PAYLOAD })).mockResolvedValueOnce(res(200, { qrPayload: PAYLOAD }));
    const a = await t.attendance.ticket(102);
    const b = await t.attendance.ticket(102);
    expect(t.fetch).toHaveBeenCalledTimes(3);
    expect(a).not.toBe(b);
  });

  it('TICKET_UNAVAILABLE passes through with its code (not UNKNOWN)', async () => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(404, { code: 'TICKET_UNAVAILABLE', message: 'Attendance is pending approval.' }));
    const e = await failure(t.attendance.ticket(102));
    expect(e.code).toBe('TICKET_UNAVAILABLE');
    expect(e.status).toBe(404);
    expect(e.message).toBe('There is no ticket for you yet: your attendance is not approved.');
    expect(t.auth.current()).not.toBeNull();
  });

  it.each([{ qrPayload: 42, extra: PAYLOAD }, { ticket: PAYLOAD }, PAYLOAD, { qrPayload: '' }])(
    'a malformed body %j is UNKNOWN and the error carries no payload',
    async (body) => {
      const t = make();
      await signInWithPopup(t);
      t.fetch.mockResolvedValueOnce(res(200, body));
      const e = await failure(t.attendance.ticket(102));
      expect(e.code).toBe('UNKNOWN');
      expect(JSON.stringify({ m: e.message, d: e.details, s: e.stack })).not.toContain(PAYLOAD);
    }
  );

  it.each(['sessionStorage', 'localStorage'] as const)('with session %s, no storage write and no onChange carries the payload', async (session) => {
    const t = make({ session });
    const seen: unknown[] = [];
    t.auth.onChange((v) => seen.push(v));
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(200, { qrPayload: PAYLOAD }));
    await t.attendance.ticket(102);
    let writes = 0;
    for (const s of Object.values(t.fb.storages)) {
      for (const v of s.map.values()) {
        writes++;
        expect(v).not.toContain(PAYLOAD);
      }
    }
    expect(writes).toBeGreaterThan(0); // the session itself was stored, so the scan saw something
    expect(JSON.stringify(seen)).not.toContain(PAYLOAD);
  });
});

describe('attendance.form (f)', () => {
  it('maps the questions, keeping an unknown type', async () => {
    const t = make();
    await signInWithPopup(t);
    const questions = [
      { id: 7, type: 'TEXT', label: 'Bölüm', required: false, options: null },
      { id: 8, type: 'BOOLEAN', label: 'Araç?', required: false, options: ['true', 'false'] },
      { id: 9, type: 'SIGNATURE', label: 'Yeni tür', required: false, options: null },
    ];
    t.fetch.mockResolvedValueOnce(res(200, { questions, appRequired: false }));
    expect(await t.attendance.form(102)).toEqual({ questions, appRequired: false });
  });

  it('no form: empty questions', async () => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(200, { questions: [], appRequired: false }));
    expect(await t.attendance.form(102)).toEqual({ questions: [], appRequired: false });
  });

  it('appRequired is passed through', async () => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(200, { questions: [{ id: 3, type: 'DOCUMENT', label: 'Belge', required: false, options: null }], appRequired: true }));
    expect((await t.attendance.form(102)).appRequired).toBe(true);
  });

  it.each([{ questions: 'x', appRequired: false }, { questions: [] }, { questions: [{ id: 'a', type: 'TEXT', label: 'x' }], appRequired: false }, undefined])(
    'a malformed body %j is UNKNOWN',
    async (body) => {
      const t = make();
      await signInWithPopup(t);
      t.fetch.mockResolvedValueOnce(res(200, body));
      expect((await failure(t.attendance.form(102))).code).toBe('UNKNOWN');
    }
  );
});

describe('attendance.apply (g)', () => {
  it('sends answers as { questionId, answerText } and returns the status', async () => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(200, { status: 'PENDING_APPROVAL' }));
    const r = await t.attendance.apply(102, [
      { questionId: 7, answer: 'Bilgisayar Müh.' },
      { questionId: 8, answer: 'true' },
    ]);
    expect(r).toEqual({ status: 'PENDING_APPROVAL' });
    expect(JSON.parse(t.fetch.mock.calls[1][1]!.body as string)).toEqual({
      answers: [
        { questionId: 7, answerText: 'Bilgisayar Müh.' },
        { questionId: 8, answerText: 'true' },
      ],
    });
  });

  it('an empty answer list is sent', async () => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(200, { status: 'JOINED' }));
    expect(await t.attendance.apply(102, [])).toEqual({ status: 'JOINED' });
    expect(JSON.parse(t.fetch.mock.calls[1][1]!.body as string)).toEqual({ answers: [] });
  });

  it.each<[string, unknown]>([
    ['not an array', { questionId: 1, answer: 'x' }],
    ['a bad questionId', [{ questionId: 0, answer: 'x' }]],
    ['a fractional questionId', [{ questionId: 1.5, answer: 'x' }]],
    ['a non-string answer', [{ questionId: 1, answer: true }]],
    ['an answer over 1024', [{ questionId: 1, answer: 'x'.repeat(1025) }]],
    ['a repeated question', [{ questionId: 1, answer: 'a' }, { questionId: 1, answer: 'b' }]],
    ['a null entry', [null]],
  ])('%s is INVALID_ARGUMENT, no request', async (_label, answers) => {
    const t = make();
    await signInWithPopup(t);
    expect((await failure(t.attendance.apply(102, answers as FormAnswer[]))).code).toBe('INVALID_ARGUMENT');
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });

  it('an answer of exactly 1024 characters is sent', async () => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(200, { status: 'JOINED' }));
    await t.attendance.apply(102, [{ questionId: 1, answer: 'x'.repeat(1024) }]);
    expect(t.fetch).toHaveBeenCalledTimes(2);
  });

  it.each<[UniHubErrorCode, number]>([
    ['ALREADY_JOINED', 409],
    ['APP_REQUIRED', 409],
    ['INVALID_ARGUMENT', 400],
    ['EVENT_FULL', 409],
    ['EMAIL_NOT_VERIFIED', 403],
  ])('%s rejects with that code and keeps the session', async (code, status) => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(status, { code, message: 'm' }));
    const e = await failure(t.attendance.apply(102, []));
    expect(e.code).toBe(code);
    expect(e.status).toBe(status);
    expect(t.auth.current()).not.toBeNull();
  });

  it.each(['ALREADY_JOINED', 'WAITLISTED', undefined])('a 200 status %j is UNKNOWN', async (status) => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockResolvedValueOnce(res(200, { status }));
    expect((await failure(t.attendance.apply(102, []))).code).toBe('UNKNOWN');
  });

  it('a POST is not retried on NETWORK', async () => {
    const t = make();
    await signInWithPopup(t);
    t.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect((await failure(t.attendance.apply(102, []))).code).toBe('NETWORK');
    expect(t.fetch).toHaveBeenCalledTimes(2);
  });
});
