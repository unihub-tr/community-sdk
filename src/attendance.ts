import type {
  ApplyResult,
  AttendanceApi,
  AttendanceStatus,
  EventForm,
  FormAnswer,
  FormQuestion,
  JoinStatus,
} from './types';
import { UniHubError } from './errors';
import type { Locale } from './i18n';
import type { RequestOptions, Transport } from './transport';
import type { SessionStore } from './auth/session';

const JOIN_STATUSES: ReadonlySet<string> = new Set<JoinStatus>(['JOINED', 'PENDING_APPROVAL', 'ALREADY_JOINED']);
const ATTENDANCE_STATUSES: ReadonlySet<string> = new Set<AttendanceStatus>(['NOT_JOINED', 'PENDING_APPROVAL', 'JOINED']);
const APPLY_STATUSES: ReadonlySet<string> = new Set<ApplyResult['status']>(['JOINED', 'PENDING_APPROVAL']);
/** The backend refuses longer answers (`answerText` > 1024). */
const MAX_ANSWER_CHARS = 1024;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function createAttendance(transport: Transport, session: SessionStore, locale: Locale): AttendanceApi {
  const invalid = (message: string) => new UniHubError('INVALID_ARGUMENT', 0, { locale, message: `unihub-community-sdk: ${message}` });
  /** A 200 whose body is not what the contract says. `kept` goes to details; never pass a ticket. */
  const unexpected = (kept?: string) => new UniHubError('UNKNOWN', 200, { locale, details: { backendMessage: kept } });

  function checkId(eventId: number): void {
    if (!Number.isSafeInteger(eventId) || eventId <= 0) throw invalid(`eventId must be a positive integer: ${String(eventId)}`);
  }

  /** Every attendance call: the visitor's session, or NOT_SIGNED_IN with no request; a refused session is cleared. */
  async function call<T>(eventId: number, route: string, options: Omit<RequestOptions, 'token'>): Promise<T> {
    checkId(eventId);
    const s = session.get();
    if (!s) throw new UniHubError('NOT_SIGNED_IN', 0, { locale });
    try {
      return await transport.request<T>(`/events/${eventId}/${route}`, { ...options, token: s.token });
    } catch (e) {
      // The server no longer accepts this session (expired, signed out elsewhere).
      if (e instanceof UniHubError && e.code === 'NOT_SIGNED_IN') session.clear(s.token);
      throw e;
    }
  }

  function statusOf<S extends string>(body: unknown, allowed: ReadonlySet<string>): S {
    const status = isRecord(body) ? body.status : undefined;
    if (typeof status !== 'string' || !allowed.has(status)) throw unexpected(typeof status === 'string' ? status : undefined);
    return status as S;
  }

  function question(q: unknown): FormQuestion {
    if (
      !isRecord(q) ||
      !Number.isSafeInteger(q.id) ||
      typeof q.type !== 'string' ||
      typeof q.label !== 'string' ||
      !(q.options === null || q.options === undefined || (Array.isArray(q.options) && q.options.every((o) => typeof o === 'string')))
    ) {
      throw unexpected('Unexpected form question.');
    }
    return {
      id: q.id as number,
      type: q.type,
      label: q.label,
      required: q.required === true,
      options: Array.isArray(q.options) ? [...(q.options as string[])] : null,
    };
  }

  function checkAnswers(answers: FormAnswer[]): Array<{ questionId: number; answerText: string }> {
    if (!Array.isArray(answers)) throw invalid('answers must be an array.');
    const seen = new Set<number>();
    return answers.map((a, i) => {
      if (!isRecord(a) || !Number.isSafeInteger(a.questionId) || (a.questionId as number) <= 0) {
        throw invalid(`answers[${i}].questionId must be a positive integer.`);
      }
      if (typeof a.answer !== 'string') throw invalid(`answers[${i}].answer must be a string.`);
      if (a.answer.length > MAX_ANSWER_CHARS) throw invalid(`answers[${i}].answer is longer than ${MAX_ANSWER_CHARS} characters.`);
      if (seen.has(a.questionId as number)) throw invalid(`question ${a.questionId} is answered twice.`);
      seen.add(a.questionId as number);
      return { questionId: a.questionId as number, answerText: a.answer };
    });
  }

  return {
    async join(eventId) {
      const body = await call<unknown>(eventId, 'join', { method: 'POST' });
      return { status: statusOf<JoinStatus>(body, JOIN_STATUSES) };
    },

    async status(eventId) {
      const body = await call<unknown>(eventId, 'status', { method: 'GET' });
      return { status: statusOf<AttendanceStatus>(body, ATTENDANCE_STATUSES) };
    },

    async leave(eventId) {
      await call<unknown>(eventId, 'attendance', { method: 'DELETE' });
    },

    async ticket(eventId) {
      // No store, no memo: a new request and a new object every time (plan D4).
      const body = await call<unknown>(eventId, 'ticket', { method: 'GET', noStore: true });
      const qrPayload = isRecord(body) ? body.qrPayload : undefined;
      if (typeof qrPayload !== 'string' || qrPayload === '') throw unexpected('Unexpected ticket response.');
      return { qrPayload };
    },

    async form(eventId) {
      const body = await call<unknown>(eventId, 'form', { method: 'GET' });
      if (!isRecord(body) || !Array.isArray(body.questions) || typeof body.appRequired !== 'boolean') {
        throw unexpected('Unexpected form response.');
      }
      const form: EventForm = { questions: body.questions.map(question), appRequired: body.appRequired };
      return form;
    },

    async apply(eventId, answers) {
      checkId(eventId);
      const sent = checkAnswers(answers);
      const body = await call<unknown>(eventId, 'apply', { method: 'POST', body: { answers: sent } });
      return { status: statusOf<ApplyResult['status']>(body, APPLY_STATUSES) };
    },
  };
}
