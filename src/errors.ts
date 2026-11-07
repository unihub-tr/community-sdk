import { message, type Locale } from './i18n';

/**
 * Stable error codes (SRS §4.1). Callers branch on `code`, never on `message`,
 * which is localised and may change.
 */
export const ERROR_CODES = [
  'INVALID_ARGUMENT',
  'KEY_INVALID',
  'ORIGIN_NOT_ALLOWED',
  'RATE_LIMITED',
  'NOT_SIGNED_IN',
  'NOT_REGISTERED',
  'EMAIL_NOT_VERIFIED',
  'VERIFIED_MEMBERS_ONLY',
  'MEMBERS_ONLY',
  'EVENT_FULL',
  'EVENT_CLOSED',
  'EVENT_NOT_FOUND',
  'ALREADY_JOINED',
  'FORM_REQUIRED',
  'TICKET_UNAVAILABLE',
  'APP_REQUIRED',
  'SIGN_IN_CANCELLED',
  'POPUP_BLOCKED',
  'NETWORK',
  'UNKNOWN',
] as const;

export type UniHubErrorCode = (typeof ERROR_CODES)[number];

export interface UniHubErrorDetails {
  /** Raw text the backend sent, when there was one. */
  backendMessage?: string;
  /** The backend's `code` when the SDK does not know it (the error's `code` is then `UNKNOWN`). */
  backendCode?: string;
  /** For RATE_LIMITED: how long the server asked us to wait, when it said. */
  retryAfterMs?: number;
}

export class UniHubError extends Error {
  public readonly code: UniHubErrorCode;
  /** HTTP status, or 0 when no response arrived (NETWORK, INVALID_ARGUMENT). */
  public readonly status: number;
  public readonly details: UniHubErrorDetails;

  constructor(code: UniHubErrorCode, status: number, options: { locale?: Locale; details?: UniHubErrorDetails; message?: string } = {}) {
    super(options.message ?? message(code, options.locale));
    this.name = 'UniHubError';
    this.code = code;
    this.status = status;
    this.details = options.details ?? {};
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * @deprecated Use `UniHubError`. Kept because the 2026-04 README advertised it;
 * `err instanceof UniHubApiError` and `err instanceof UniHubError` are the same check.
 */
export const UniHubApiError = UniHubError;
/** @deprecated Use `UniHubError`. */
export type UniHubApiError = UniHubError;
