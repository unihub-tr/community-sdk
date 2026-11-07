import { ERROR_CODES, UniHubError, type UniHubErrorCode } from './errors';
import type { Locale } from './i18n';
import { SDK_VERSION } from './version';

/*
 * The only module that calls fetch (DBL/DependencyMaps/sdk-modules.md rule 2).
 * Everything that leaves the SDK as a failure leaves as a UniHubError with a code.
 */

/**
 * The backend refuses a second request from the same key and visitor IP within 200 ms of
 * the last one it accepted, with no Retry-After (CommunityScopedKeyFilter, until hand-off
 * row BK-08). It stamps a request on arrival, which is always before its response, so
 * starting each request this long after the previous *response* guarantees the gap.
 * Spacing only the starts does not: a cold TLS connection delays one arrival into the
 * next (measured against production, 2026-10-19).
 */
const MIN_GAP_MS = 210;
/** Wait before the one retry of a read refused with 429, when the server names no delay. */
const RATE_LIMIT_RETRY_MS = 250;
const MAX_RETRY_WAIT_MS = 2000;
/** A body that is not JSON (a proxy page, an HTML 5xx) is kept only this long in `backendMessage`. */
const MAX_RAW_MESSAGE_CHARS = 300;

export interface TransportOptions {
  baseUrl: string;
  /** The publishable community key, sent as `X-Community-Key`. */
  key: { header: 'X-Community-Key'; value: string };
  locale: Locale;
  /** Injected for tests and non-browser runtimes; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  /** Query parameters; undefined entries are left out. */
  query?: Record<string, string | number | undefined>;
  /** Visitor's ID token, sent as `Authorization: Bearer`. */
  token?: string;
  body?: unknown;
  /** Bypass the HTTP cache entirely (`cache: 'no-store'`): the response must not be stored. */
  noStore?: boolean;
}

export interface Transport {
  request<T>(path: string, options: RequestOptions): Promise<T>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createTransport(options: TransportOptions): Transport {
  const { baseUrl, key, locale } = options;
  const doFetch = (...args: Parameters<typeof fetch>) => (options.fetch ?? globalThis.fetch)(...args);

  // One request at a time; each starts MIN_GAP_MS after the previous one's response.
  let queue: Promise<unknown> = Promise.resolve();
  let lastResponseAt = Number.NEGATIVE_INFINITY;

  function send(url: string, init: RequestInit): Promise<Response> {
    const turn = queue.then(async () => {
      const wait = lastResponseAt + MIN_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await doFetch(url, init);
      } catch (cause) {
        throw new UniHubError('NETWORK', 0, { locale, details: { backendMessage: String((cause as Error)?.message ?? cause) } });
      } finally {
        lastResponseAt = Date.now();
      }
    });
    queue = turn.catch(() => undefined);
    return turn;
  }

  return {
    async request<T>(path: string, ro: RequestOptions): Promise<T> {
      const headers = new Headers({ [key.header]: key.value, 'X-SDK-Version': SDK_VERSION });
      if (ro.body !== undefined) headers.set('Content-Type', 'application/json');
      if (ro.token) headers.set('Authorization', `Bearer ${ro.token}`);
      const init: RequestInit = {
        method: ro.method,
        headers,
        body: ro.body === undefined ? undefined : JSON.stringify(ro.body),
      };
      if (ro.noStore) init.cache = 'no-store';
      const url = `${baseUrl}${path}${queryString(ro.query)}`;

      let response: Response;
      try {
        response = await send(url, init);
      } catch (e) {
        // One retry, reads only: a POST may have reached the server (SRS NFR-09).
        if (ro.method !== 'GET' || !(e instanceof UniHubError) || e.code !== 'NETWORK') throw e;
        response = await send(url, init);
      }
      if (response.status === 429 && ro.method === 'GET') {
        // Another tab or SDK instance on the same key and IP; a read is safe to repeat once.
        await sleep(Math.min(retryAfterMs(response) ?? RATE_LIMIT_RETRY_MS, MAX_RETRY_WAIT_MS));
        response = await send(url, init);
      }

      const text = await response.text().catch(() => '');
      const body = parseBody(text);
      if (response.ok) return body as T;
      throw toError(response, body, text, locale);
    },
  };
}

function queryString(query: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) params.set(name, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stringField(body: unknown, name: string): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

function backendMessageOf(body: unknown, text: string): string | undefined {
  const field = stringField(body, 'message') ?? stringField(body, 'error');
  if (field !== undefined) return field;
  if (!text) return undefined;
  return text.length > MAX_RAW_MESSAGE_CHARS ? `${text.slice(0, MAX_RAW_MESSAGE_CHARS)}…` : text;
}

/**
 * Spring's ResponseStatusException#getMessage() reads `401 UNAUTHORIZED "<reason>"`; the
 * backend still sends that string as `message` when a key lookup fails. Return the reason alone.
 */
export function unwrapBackendMessage(text: string): string {
  const m = /^\d{3} [A-Z_]+ "([\s\S]*)"$/.exec(text.trim());
  return (m ? m[1] : text).trim();
}

/**
 * Codes the backend may send (hand-off BK-05). NETWORK (no response arrived), SIGN_IN_CANCELLED and
 * POPUP_BLOCKED (Phase 04) are the SDK's own.
 */
const SDK_ONLY_CODES: ReadonlySet<string> = new Set(['NETWORK', 'SIGN_IN_CANCELLED', 'POPUP_BLOCKED']);
const BACKEND_CODES: ReadonlySet<string> = new Set(ERROR_CODES.filter((c) => !SDK_ONLY_CODES.has(c)));

function retryAfterMs(response: Response): number | undefined {
  const h = response.headers.get('Retry-After');
  if (!h) return undefined;
  const seconds = Number(h);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(h);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/**
 * The backend names every community failure as `{code, message}` (hand-off BK-05). A body
 * without a usable code — a proxy, an HTML 5xx, an empty body — falls back to the status.
 */
function toError(response: Response, body: unknown, text: string, locale: Locale): UniHubError {
  const raw = backendMessageOf(body, text);
  const backendMessage = raw === undefined ? undefined : unwrapBackendMessage(raw);
  const sent = stringField(body, 'code');
  let code: UniHubErrorCode;
  let backendCode: string | undefined;
  if (response.status === 429) {
    code = 'RATE_LIMITED';
  } else if (sent !== undefined && BACKEND_CODES.has(sent)) {
    code = sent as UniHubErrorCode;
  } else if (sent !== undefined) {
    code = 'UNKNOWN';
    backendCode = sent;
  } else {
    code = response.status === 401 ? 'KEY_INVALID' : 'UNKNOWN';
  }
  return new UniHubError(code, response.status, {
    locale,
    details: { backendMessage, backendCode, retryAfterMs: response.status === 429 ? retryAfterMs(response) : undefined },
  });
}
