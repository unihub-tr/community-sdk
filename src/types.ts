import type { Locale } from './i18n';

export type JoinStatus = 'JOINED' | 'PENDING_APPROVAL' | 'ALREADY_JOINED';

export interface JoinResult {
  /**
   * `JOINED` — attendance approved; `PENDING_APPROVAL` — a club manager must approve;
   * `ALREADY_JOINED` — the visitor was already registered (joining is idempotent).
   */
  status: JoinStatus;
}

export interface UniHubConfig {
  /**
   * Publishable community key (`uhpk_…`) issued by UniHub admins, bound to your site's
   * origins. Safe to ship in a web page; a master key is not, and is refused.
   */
  key: string;

  /**
   * Community API base URL. Default: `https://api.unihub.tr/api/v1/community`.
   * Must be HTTPS, except `http://localhost` / `http://127.0.0.1` for local testing.
   */
  baseUrl?: string;

  /** Language of `UniHubError.message`. Default `tr`. */
  locale?: Locale;

  /** Custom fetch, for tests or runtimes without a global one. */
  fetch?: typeof fetch;

  /**
   * Where the visitor's session is kept. Default `memory`: it is gone after a page reload, and
   * the visitor signs in again (one click while they are still signed in on UniHub).
   * `sessionStorage` / `localStorage` keep it across reloads; choose them knowingly, since any
   * script on your page can read browser storage (SRS NFR-01).
   */
  session?: SessionPersistence;
}

export type SessionPersistence = 'memory' | 'sessionStorage' | 'localStorage';

/**
 * The signed-in visitor, exactly as UniHub shares it with your site. Nothing else is shared:
 * no e-mail, phone, student number or school.
 */
export interface Visitor {
  /** UniHub user id. */
  userId: number;
  /** "Name Surname". */
  displayName: string;
  avatarUrl: string | null;
  /** Some events need a verified e-mail to join (`EMAIL_NOT_VERIFIED`). */
  emailVerified: boolean;
}

export interface SignInOptions {
  /**
   * `popup` (default) opens UniHub's login page in a pop-up; call `signIn()` from a click
   * handler or the browser blocks it (`POPUP_BLOCKED`). `redirect` leaves your page and comes
   * back; call `auth.handleRedirect()` when the page loads.
   */
  mode?: 'popup' | 'redirect';
  /** Redirect mode only: where to come back to. Same origin as the page; default the current URL. */
  returnUrl?: string;
}

export interface AuthApi {
  /**
   * Signs the visitor in on UniHub's page (`https://www.unihub.tr/connect`). Resolves with the
   * visitor; rejects `SIGN_IN_CANCELLED` (closed or cancelled), `POPUP_BLOCKED`, or a backend code.
   * In redirect mode the page navigates away and the promise never settles.
   */
  signIn(options?: SignInOptions): Promise<Visitor>;
  /** Same page as `signIn` — it offers registration ("Kayıt Ol"). */
  register(options?: SignInOptions): Promise<Visitor>;
  /**
   * Finishes a redirect sign-in. Call it once when the page loads: resolves the visitor after
   * a redirect, `null` when the URL carries no sign-in result.
   */
  handleRedirect(): Promise<Visitor | null>;
  /** The signed-in visitor, or `null` (also once the session has expired). */
  current(): Visitor | null;
  /** Called on every change (sign-in, sign-out, expiry). Returns an unsubscribe function. */
  onChange(listener: (visitor: Visitor | null) => void): () => void;
  /** Ends the session on UniHub and here. Never rejects. */
  signOut(): Promise<void>;
}

export interface AttendanceApi {
  /**
   * Joins an event of the key's club as the signed-in visitor. Rejects `NOT_SIGNED_IN` when no
   * session is active (no request is sent), or a refusal such as `EMAIL_NOT_VERIFIED`,
   * `MEMBERS_ONLY`, `EVENT_CLOSED`, `FORM_REQUIRED`.
   */
  join(eventId: number): Promise<JoinResult>;
  /** The signed-in visitor's attendance of an event. */
  status(eventId: number): Promise<AttendanceStatusResult>;
  /** Leaves the event. Resolves also when the visitor was not attending (idempotent). */
  leave(eventId: number): Promise<void>;
  /**
   * The visitor's check-in ticket. Only for an approved attendance; otherwise rejects
   * `TICKET_UNAVAILABLE`. Fetched fresh on every call, never cached by the SDK.
   */
  ticket(eventId: number): Promise<Ticket>;
  /** The event's application form. No form → `{ questions: [], appRequired: false }`. */
  form(eventId: number): Promise<EventForm>;
  /**
   * Submits the application form, which also joins. Rejects `ALREADY_JOINED` (nothing saved),
   * `APP_REQUIRED` (the form asks for a document), `INVALID_ARGUMENT`, or a join refusal.
   */
  apply(eventId: number, answers: FormAnswer[]): Promise<ApplyResult>;
}

/** `NOT_JOINED` — no attendance; `PENDING_APPROVAL` — a club manager must approve; `JOINED` — approved. */
export type AttendanceStatus = 'NOT_JOINED' | 'PENDING_APPROVAL' | 'JOINED';

export interface AttendanceStatusResult {
  status: AttendanceStatus;
}

export interface Ticket {
  /**
   * The string to encode as a QR code: the same one the UniHub app shows, single use at
   * check-in, valid from one hour before the event to 24 hours after. Draw it with any QR
   * library and keep it only while it is on screen. **Do not log, store or send it anywhere.**
   */
  qrPayload: string;
}

/** Known question types; a type added on the backend later arrives as its own string. */
export type FormQuestionType = 'TEXT' | 'BOOLEAN' | 'PHONE' | 'EMAIL' | 'DOCUMENT' | (string & {});

export interface FormQuestion {
  id: number;
  type: FormQuestionType;
  label: string;
  /** Always `false` today: the backend enforces no required questions and accepts blank answers. */
  required: boolean;
  /** `['true', 'false']` for `BOOLEAN` (answer with one of them); otherwise `null`. */
  options: string[] | null;
}

export interface EventForm {
  questions: FormQuestion[];
  /**
   * `true` when the form asks for a document, which only the UniHub app can upload: `apply`
   * then rejects `APP_REQUIRED`, and the site should send the visitor to the app.
   */
  appRequired: boolean;
}

export interface FormAnswer {
  questionId: number;
  /** At most 1024 characters. An empty string is a blank answer. */
  answer: string;
}

export interface ApplyResult {
  status: 'JOINED' | 'PENDING_APPROVAL';
}

export type EventStatus = 'UPCOMING' | 'PAST';

/**
 * One public event of the key's club, as listed. Times are ISO-8601 strings with the
 * Europe/Istanbul offset (e.g. `2026-11-01T19:00:00+03:00`), passed through unparsed.
 */
export interface EventSummary {
  id: number;
  title: string;
  /** null when the event has no date. */
  startsAt: string | null;
  location: string | null;
  imageUrl: string | null;
  status: EventStatus;
  /** Last moment to join; the event's own time when no separate deadline was set. */
  registrationDeadline: string | null;
}

export interface EventDetail extends EventSummary {
  description: string;
  /** Always null today: the backend has no capacity. */
  capacity: number | null;
  /** Joining needs the event's application form (Phase 04: `attendance.apply`). */
  requiresForm: boolean;
  /** Only approved club members can **join**. It says nothing about who can see the event. */
  membersOnly: boolean;
  /** Joining needs a verified email address. */
  verifiedOnly: boolean;
  /** A club manager approves each attendee (join resolves `PENDING_APPROVAL`). */
  approvalRequired: boolean;
}

/** One page of results; `page` is 0-based. */
export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

export interface ListEventsOptions {
  /** Default `upcoming` (soonest first); `past` is most recent first. */
  when?: 'upcoming' | 'past';
  /** 0-based page number. Default 0. */
  page?: number;
  /** Items per page, 1–50. Default 20. */
  size?: number;
}

export interface EventsApi {
  /** Public events of the key's club. */
  list(options?: ListEventsOptions): Promise<Page<EventSummary>>;
  /** One public event of the key's club; anything else rejects `EVENT_NOT_FOUND`. */
  get(id: number): Promise<EventDetail>;
}

export interface UniHub {
  readonly events: EventsApi;
  readonly auth: AuthApi;
  readonly attendance: AttendanceApi;
}
