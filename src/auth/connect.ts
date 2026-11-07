import { UniHubError } from '../errors';
import type { Locale } from '../i18n';
import type { BrowserEnv, PopupLike } from './browser';
import { challengeFor, createPkce, type CryptoLike } from './pkce';

/*
 * UniHub's hosted login page (my-uni-hub-web /connect, BK-07 design §1–§2). Fixed, not an
 * option: a site that could point the SDK elsewhere could collect its visitors' sign-ins.
 */
export const CONNECT_URL = 'https://www.unihub.tr/connect';
export const CONNECT_ORIGIN = 'https://www.unihub.tr';

const POPUP_NAME = 'unihub-connect';
const POPUP_FEATURES = 'popup,width=480,height=720';
const CLOSED_POLL_MS = 500;
/** Query parameters /connect sends back on a redirect; stripped from the address bar (A1). */
const RESULT_PARAMS = ['unihub_code', 'unihub_error', 'state'] as const;

export interface ConnectCode {
  code: string;
  verifier: string;
}

export function buildConnectUrl(p: {
  key: string;
  origin: string;
  state: string;
  challenge: string;
  mode: 'popup' | 'redirect';
  returnUrl?: string;
}): string {
  const q = new URLSearchParams({ client: p.key, origin: p.origin, state: p.state, code_challenge: p.challenge, mode: p.mode });
  if (p.mode === 'redirect' && p.returnUrl) q.set('return', p.returnUrl);
  return `${CONNECT_URL}?${q.toString()}`;
}

const cancelled = (locale: Locale) => new UniHubError('SIGN_IN_CANCELLED', 0, { locale });

export function requireCrypto(env: BrowserEnv, locale: Locale): CryptoLike {
  if (env.crypto) return env.crypto;
  throw new UniHubError('INVALID_ARGUMENT', 0, {
    locale,
    message: 'unihub-community-sdk: sign-in needs Web Crypto (a secure context: https, or http://localhost).',
  });
}

/** Opens the popup. Must run synchronously inside the click handler, before any await. */
export function openPopup(env: BrowserEnv, locale: Locale): PopupLike {
  const popup = env.open('', POPUP_NAME, POPUP_FEATURES);
  if (!popup) throw new UniHubError('POPUP_BLOCKED', 0, { locale });
  return popup;
}

/**
 * Drives an opened popup to /connect and waits for its one message. Accepts exactly
 * `origin === CONNECT_ORIGIN`, `source === popup`, our `type` and our `state`; ignores
 * everything else. Closing the popup, or a cancel from the page, rejects SIGN_IN_CANCELLED.
 */
export function popupCode(env: BrowserEnv, popup: PopupLike, key: string, locale: Locale): Promise<ConnectCode> {
  const crypto = requireCrypto(env, locale);
  const { verifier, state } = createPkce(crypto);
  return new Promise<ConnectCode>((resolve, reject) => {
    let done = false;
    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      removeListener();
      clearInterval(poll);
      settle();
    };
    const fail = (e: unknown) =>
      finish(() => {
        try {
          popup.close();
        } catch {
          // Already gone.
        }
        reject(e);
      });

    const removeListener = env.onMessage((event) => {
      if (event.origin !== CONNECT_ORIGIN || event.source !== popup) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object' || data.type !== 'unihub:connect' || data.state !== state) return;
      if (typeof data.code === 'string' && data.code) {
        const code = data.code;
        finish(() => resolve({ code, verifier }));
      } else {
        finish(() => reject(cancelled(locale)));
      }
    });
    const poll = setInterval(() => {
      let closed = false;
      try {
        closed = popup.closed;
      } catch {
        closed = false;
      }
      if (closed) finish(() => reject(cancelled(locale)));
    }, CLOSED_POLL_MS);

    challengeFor(crypto, verifier).then(
      (challenge) => {
        if (done) return;
        try {
          popup.location.href = buildConnectUrl({ key, origin: env.origin, state, challenge, mode: 'popup' });
        } catch (e) {
          fail(e);
        }
      },
      () => fail(new UniHubError('INVALID_ARGUMENT', 0, { locale, message: 'unihub-community-sdk: Web Crypto refused SHA-256.' }))
    );
  });
}

// --- Redirect ---

interface PendingRedirect {
  verifier: string;
  state: string;
  returnUrl: string;
}

export function pendingKey(key: string): string {
  return `unihub:connect:${key}`;
}

/** The current URL without the parameters /connect adds on its way back. */
export function withoutResultParams(href: string): URL {
  const url = new URL(href);
  for (const p of RESULT_PARAMS) url.searchParams.delete(p);
  return url;
}

/** Stores the PKCE values (not a token) in sessionStorage, then leaves for /connect. */
export async function redirectStart(env: BrowserEnv, key: string, locale: Locale, returnUrl?: string): Promise<never> {
  const crypto = requireCrypto(env, locale);
  let target: URL;
  try {
    target = returnUrl === undefined ? withoutResultParams(env.href()) : new URL(returnUrl, env.href());
  } catch {
    target = new URL('about:invalid');
  }
  if (target.origin !== env.origin) {
    throw new UniHubError('INVALID_ARGUMENT', 0, {
      locale,
      message: 'unihub-community-sdk: returnUrl must be on the same origin as this page.',
    });
  }
  const storage = env.storage('sessionStorage');
  if (!storage) {
    throw new UniHubError('INVALID_ARGUMENT', 0, {
      locale,
      message: 'unihub-community-sdk: redirect sign-in needs sessionStorage; use the popup.',
    });
  }
  const { verifier, state } = createPkce(crypto);
  const challenge = await challengeFor(crypto, verifier);
  const pending: PendingRedirect = { verifier, state, returnUrl: target.toString() };
  storage.setItem(pendingKey(key), JSON.stringify(pending));
  env.assign(buildConnectUrl({ key, origin: env.origin, state, challenge, mode: 'redirect', returnUrl: pending.returnUrl }));
  return new Promise<never>(() => undefined);
}

/**
 * Reads a redirect result from the address bar. Strips it with replaceState before anything
 * else (A1), so the code never stays in history or leaves through Referer. Returns null when
 * the URL carries no result; otherwise the code to exchange, or rejects SIGN_IN_CANCELLED.
 */
export function redirectFinish(env: BrowserEnv, key: string, locale: Locale): ConnectCode | null {
  const url = new URL(env.href());
  const code = url.searchParams.get('unihub_code');
  const error = url.searchParams.get('unihub_error');
  if (code === null && error === null) return null;
  const state = url.searchParams.get('state');
  env.replaceState(withoutResultParams(url.toString()).toString());

  const storage = env.storage('sessionStorage');
  let pending: PendingRedirect | null = null;
  try {
    const raw = storage?.getItem(pendingKey(key)) ?? null;
    storage?.removeItem(pendingKey(key));
    const o = raw ? (JSON.parse(raw) as Partial<PendingRedirect>) : null;
    if (o && typeof o.verifier === 'string' && typeof o.state === 'string') pending = o as PendingRedirect;
  } catch {
    pending = null;
  }
  // No stored attempt or another state: not a sign-in this page started. Never exchange it.
  if (!pending || state !== pending.state || error !== null || !code) throw cancelled(locale);
  return { code, verifier: pending.verifier };
}
