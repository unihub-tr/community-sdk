import type { EventDetail, EventsApi, EventSummary, ListEventsOptions, Page } from './types';
import { UniHubError } from './errors';
import type { Locale } from './i18n';
import type { Transport } from './transport';

/** The backend's limit (CommunityEventService); checked here so a bad call never costs a request. */
const MAX_PAGE_SIZE = 50;

export function createEvents(transport: Transport, locale: Locale): EventsApi {
  const invalid = (what: string) => new UniHubError('INVALID_ARGUMENT', 0, { locale, message: `unihub-community-sdk: ${what}` });

  return {
    async list(options: ListEventsOptions = {}): Promise<Page<EventSummary>> {
      const { when = 'upcoming', page, size } = options;
      if (when !== 'upcoming' && when !== 'past') throw invalid(`'when' must be 'upcoming' or 'past'.`);
      if (page !== undefined && !(Number.isInteger(page) && page >= 0)) throw invalid(`'page' must be an integer >= 0.`);
      if (size !== undefined && !(Number.isInteger(size) && size >= 1 && size <= MAX_PAGE_SIZE)) {
        throw invalid(`'size' must be an integer from 1 to ${MAX_PAGE_SIZE}.`);
      }

      const body = await transport.request<Partial<Page<Partial<EventSummary>>>>('/events', {
        method: 'GET',
        query: { when, page, size },
      });
      if (!body || !Array.isArray(body.items)) {
        throw new UniHubError('UNKNOWN', 200, { locale, details: { backendMessage: 'event list without items' } });
      }
      return {
        items: body.items.map(toSummary),
        page: body.page ?? 0,
        size: body.size ?? body.items.length,
        totalItems: body.totalItems ?? body.items.length,
        totalPages: body.totalPages ?? 0,
      };
    },

    async get(id: number): Promise<EventDetail> {
      if (!(Number.isSafeInteger(id) && id > 0)) throw invalid(`event id must be a positive integer.`);
      const dto = await transport.request<Partial<EventDetail>>(`/events/${id}`, { method: 'GET' });
      return {
        ...toSummary(dto ?? {}),
        description: dto?.description ?? '',
        capacity: dto?.capacity ?? null,
        requiresForm: dto?.requiresForm ?? false,
        membersOnly: dto?.membersOnly ?? false,
        verifiedOnly: dto?.verifiedOnly ?? false,
        approvalRequired: dto?.approvalRequired ?? false,
      };
    },
  };
}

function toSummary(dto: Partial<EventSummary>): EventSummary {
  return {
    id: dto.id as number,
    title: dto.title ?? '',
    startsAt: dto.startsAt ?? null,
    location: dto.location ?? null,
    imageUrl: dto.imageUrl ?? null,
    status: dto.status === 'PAST' ? 'PAST' : 'UPCOMING',
    registrationDeadline: dto.registrationDeadline ?? null,
  };
}
