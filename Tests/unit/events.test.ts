import { describe, expect, it, vi } from 'vitest';
import { createEvents } from '../../src/events';
import { createTransport } from '../../src/transport';
import { UniHubError } from '../../src/errors';

const BASE = 'https://api.example.test/api/v1/community';

function events(...responses: Response[]) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const r of responses) fetchImpl.mockResolvedValueOnce(r);
  const transport = createTransport({ baseUrl: BASE, key: { header: 'X-Community-Key', value: 'uhpk_live_test' }, locale: 'en', fetch: fetchImpl });
  return { api: createEvents(transport, 'en'), fetchImpl };
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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// Shapes as unihub-backend 8bd83e3 sends them (CommunityEventSummaryDto / DetailDto / PageDto).
const SUMMARY = {
  id: 98,
  title: 'Test',
  startsAt: '2026-10-20T19:10:00+03:00',
  location: 'test',
  imageUrl: null,
  status: 'UPCOMING',
  registrationDeadline: '2026-10-20T19:10:00+03:00',
};
const PAGE = { items: [SUMMARY], page: 0, size: 20, totalItems: 1, totalPages: 1 };
const DETAIL = {
  ...SUMMARY,
  description: 'd',
  capacity: null,
  requiresForm: true,
  membersOnly: true,
  verifiedOnly: false,
  approvalRequired: false,
};

describe('events.list', () => {
  it('asks for upcoming events by default, with no page or size unless given', async () => {
    const { api, fetchImpl } = events(json(PAGE));
    expect(await api.list()).toEqual(PAGE);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/events?when=upcoming`);
    expect(fetchImpl.mock.calls[0][1]!.method).toBe('GET');
  });

  it('passes when, page and size through', async () => {
    const { api, fetchImpl } = events(json({ ...PAGE, items: [] }));
    await api.list({ when: 'past', page: 2, size: 50 });
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/events?when=past&page=2&size=50`);
  });

  it.each([
    [{ when: 'soon' as 'past' }],
    [{ page: -1 }],
    [{ page: 1.5 }],
    [{ size: 0 }],
    [{ size: 51 }],
    [{ size: Number.NaN }],
  ])('%o is INVALID_ARGUMENT, before any request', async (options) => {
    const { api, fetchImpl } = events();
    expect((await failure(api.list(options))).code).toBe('INVALID_ARGUMENT');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('absent optional fields become null', async () => {
    const { api } = events(json({ ...PAGE, items: [{ id: 5, title: 'x', status: 'PAST' }] }));
    const [item] = (await api.list()).items;
    expect(item).toEqual({ id: 5, title: 'x', startsAt: null, location: null, imageUrl: null, status: 'PAST', registrationDeadline: null });
  });

  it('a 200 without an items array is UNKNOWN, never an empty page', async () => {
    const { api } = events(json({ page: 0 }));
    expect((await failure(api.list())).code).toBe('UNKNOWN');
  });
});

describe('events.get', () => {
  it('reads /events/{id} into an EventDetail', async () => {
    const { api, fetchImpl } = events(json(DETAIL));
    expect(await api.get(98)).toEqual(DETAIL);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/events/98`);
  });

  it('keeps null times and capacity, and defaults absent flags to false', async () => {
    const { api } = events(json({ id: 9, title: 't', startsAt: null, registrationDeadline: null, status: 'UPCOMING' }));
    expect(await api.get(9)).toMatchObject({
      startsAt: null,
      registrationDeadline: null,
      description: '',
      capacity: null,
      requiresForm: false,
      membersOnly: false,
      verifiedOnly: false,
      approvalRequired: false,
    });
  });

  it.each([0, -3, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('id %s is INVALID_ARGUMENT, before any request', async (id) => {
    const { api, fetchImpl } = events();
    expect((await failure(api.get(id))).code).toBe('INVALID_ARGUMENT');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('404 "Event not found." (another club, private or deleted) is EVENT_NOT_FOUND', async () => {
    const { api } = events(json({ code: 'EVENT_NOT_FOUND', message: 'Event not found.' }, 404));
    const e = await failure(api.get(12345));
    expect(e.code).toBe('EVENT_NOT_FOUND');
    expect(e.status).toBe(404);
  });
});
