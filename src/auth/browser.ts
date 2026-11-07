import type { CryptoLike } from './pkce';

/*
 * The only place the SDK reaches for window, location, history, storage and crypto.
 * `browserEnv()` reads globalThis when it is called — from signIn / handleRedirect / a lazy
 * session load — never at import or in createUniHub (DBL/DependencyMaps/sdk-modules.md rule 4).
 * Tests pass a fake BrowserEnv to createAuth; nothing here is exported from index.ts.
 */

export interface PopupLike {
  readonly closed: boolean;
  focus(): void;
  close(): void;
  location: { href: string };
}

export interface MessageLike {
  origin: string;
  source: unknown;
  data: unknown;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BrowserEnv {
  /** `location.origin` of the page. */
  readonly origin: string;
  /** Current `location.href`. */
  href(): string;
  /** `location.assign(url)`. */
  assign(url: string): void;
  /** `history.replaceState(history.state, '', url)`. */
  replaceState(url: string): void;
  open(url: string, name: string, features: string): PopupLike | null;
  /** Adds a `message` listener on window; returns its remover. */
  onMessage(listener: (event: MessageLike) => void): () => void;
  /** Web Crypto, or null when the page has none (insecure context). */
  readonly crypto: CryptoLike | null;
  /** The storage, or null when it is missing or throws (private mode, blocked cookies). */
  storage(kind: 'sessionStorage' | 'localStorage'): StorageLike | null;
}

export function browserEnv(): BrowserEnv | null {
  let w: any;
  try {
    w = (globalThis as any).window;
  } catch {
    return null;
  }
  if (!w || typeof w.open !== 'function' || !w.location || typeof w.addEventListener !== 'function') return null;
  let crypto: CryptoLike | null = null;
  try {
    const c = w.crypto;
    if (c && typeof c.getRandomValues === 'function' && c.subtle && typeof c.subtle.digest === 'function') crypto = c;
  } catch {
    crypto = null;
  }
  return {
    origin: w.location.origin,
    href: () => w.location.href,
    assign: (url) => w.location.assign(url),
    replaceState: (url) => w.history.replaceState(w.history.state, '', url),
    open: (url, name, features) => w.open(url, name, features),
    onMessage(listener) {
      const handler = (e: MessageEvent) => listener({ origin: e.origin, source: e.source, data: e.data });
      w.addEventListener('message', handler);
      return () => w.removeEventListener('message', handler);
    },
    crypto,
    storage(kind) {
      try {
        const s = w[kind];
        return s && typeof s.getItem === 'function' ? s : null;
      } catch {
        return null;
      }
    },
  };
}
