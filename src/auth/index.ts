import type { AuthApi, SessionPersistence, SignInOptions, Visitor } from '../types';
import { UniHubError } from '../errors';
import type { Locale } from '../i18n';
import type { Transport } from '../transport';
import { browserEnv, type BrowserEnv, type PopupLike } from './browser';
import { openPopup, popupCode, redirectFinish, redirectStart, requireCrypto, type ConnectCode } from './connect';
import { createSessionStore, isVisitor, type SessionStore } from './session';

export interface Auth {
  api: AuthApi;
  /** For attendance: the live session, and clearing it on a refused token. Not public. */
  session: SessionStore;
}

interface TokenResponse {
  token?: unknown;
  expiresAt?: unknown;
  visitor?: unknown;
}

/**
 * `env` is the browser seam; tests pass a fake. By default it is resolved on first use,
 * so createUniHub stays SSR-safe (rule 4).
 */
export function createAuth(
  transport: Transport,
  key: string,
  locale: Locale,
  persistence: SessionPersistence,
  env: () => BrowserEnv | null = browserEnv
): Auth {
  let resolved: BrowserEnv | null | undefined;
  const getEnv = (): BrowserEnv | null => {
    if (resolved === undefined) resolved = env();
    return resolved;
  };
  const session = createSessionStore(key, persistence, getEnv);
  let pending: { popup: PopupLike; promise: Promise<Visitor> } | null = null;

  function needBrowser(): BrowserEnv {
    const e = getEnv();
    if (e) return e;
    throw new UniHubError('INVALID_ARGUMENT', 0, { locale, message: 'unihub-community-sdk: sign-in runs only in a browser.' });
  }

  async function exchange(c: ConnectCode): Promise<Visitor> {
    const body = await transport.request<TokenResponse>('/connect/token', {
      method: 'POST',
      body: { code: c.code, codeVerifier: c.verifier },
    });
    const expiresAt = typeof body?.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN;
    const v = body?.visitor;
    if (typeof body?.token !== 'string' || !body.token.startsWith('uhct_') || !Number.isFinite(expiresAt) || !isVisitor(v)) {
      throw new UniHubError('UNKNOWN', 200, { locale, details: { backendMessage: 'Unexpected /connect/token response.' } });
    }
    const visitor: Visitor = { userId: v.userId, displayName: v.displayName, avatarUrl: v.avatarUrl, emailVerified: v.emailVerified };
    session.set({ token: body.token, expiresAt, visitor });
    return visitor;
  }

  function signIn(options?: SignInOptions): Promise<Visitor> {
    try {
      const mode = options?.mode ?? 'popup';
      if (mode !== 'popup' && mode !== 'redirect') {
        throw new UniHubError('INVALID_ARGUMENT', 0, { locale, message: "unihub-community-sdk: mode must be 'popup' or 'redirect'." });
      }
      const e = needBrowser();
      requireCrypto(e, locale);
      if (mode === 'redirect') return redirectStart(e, key, locale, options?.returnUrl);

      if (pending && !pending.popup.closed) {
        try {
          pending.popup.focus();
        } catch {
          // Focus is a courtesy.
        }
        return pending.promise;
      }
      // Synchronous, inside the click: a window.open after an await is blocked as a pop-up.
      const popup = openPopup(e, locale);
      const promise: Promise<Visitor> = popupCode(e, popup, key, locale)
        .then(exchange)
        .finally(() => {
          if (pending?.promise === promise) pending = null;
        });
      pending = { popup, promise };
      return promise;
    } catch (err) {
      return Promise.reject(err);
    }
  }

  const api: AuthApi = {
    signIn,
    register: (options) => signIn(options),
    async handleRedirect() {
      const e = getEnv();
      if (!e) return null;
      const code = redirectFinish(e, key, locale);
      return code ? exchange(code) : null;
    },
    current: () => session.get()?.visitor ?? null,
    onChange: (listener) => session.onChange(listener),
    async signOut() {
      const s = session.get();
      if (!s) return;
      try {
        await transport.request<void>('/session', { method: 'DELETE', token: s.token });
      } catch {
        // Best effort: the session ends here either way, and on the server within the hour.
      }
      session.clear(s.token);
    },
  };
  return { api, session };
}
