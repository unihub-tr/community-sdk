import { createHash, webcrypto } from 'node:crypto';
import { expect, vi, type Mock } from 'vitest';
import type { BrowserEnv, MessageLike, PopupLike, StorageLike } from '../../src/auth/browser';
import type { CryptoLike } from '../../src/auth/pkce';
import { createAuth } from '../../src/auth';
import { createAttendance } from '../../src/attendance';
import { createTransport } from '../../src/transport';
import type { SessionPersistence } from '../../src/types';

/*
 * A fake page + popup + opener for the auth suites. Nothing here touches the real globals.
 */

export const KEY = 'uhpk_live_test0123456789';
export const PAGE_ORIGIN = 'http://localhost:5173';
export const CONNECT_ORIGIN = 'https://www.unihub.tr';
export const BASE = 'https://api.example.test/api/v1/community';
export const TOKEN = 'uhct_secret_session_token_value';
export const VISITOR = { userId: 30, displayName: 'Ada Lovelace', avatarUrl: null, emailVerified: true };

/** SHA-256 via node:crypto, resolved on a microtask, so fake timers never stall it. */
export const fakeCrypto: CryptoLike = {
  getRandomValues: <T extends ArrayBufferView | null>(a: T): T => webcrypto.getRandomValues(a as never) as T,
  subtle: {
    digest: async (_alg: string, data: BufferSource) => {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
      const out = createHash('sha256').update(bytes).digest();
      return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
    },
  },
};

export class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

export class FakePopup implements PopupLike {
  closed = false;
  readonly hrefs: string[] = [];
  readonly focus: Mock<() => void> = vi.fn();
  close() {
    this.closed = true;
  }
  location = {
    hrefs: this.hrefs,
    set href(v: string) {
      this.hrefs.push(v);
    },
    get href() {
      return this.hrefs[this.hrefs.length - 1] ?? 'about:blank';
    },
  };
}

export interface FakeBrowser {
  env: BrowserEnv;
  popups: FakePopup[];
  /** Every `open` call's URL, in order. */
  opened: string[];
  assigned: string[];
  replaced: string[];
  /** Call order log: 'open', 'digest', 'replaceState', 'fetch'. */
  log: string[];
  storages: { sessionStorage: FakeStorage; localStorage: FakeStorage };
  storageCalls: string[];
  listeners: Set<(e: MessageLike) => void>;
  href: string;
  send(event: MessageLike): void;
}

export function fakeBrowser(options: { href?: string; crypto?: CryptoLike | null; block?: boolean } = {}): FakeBrowser {
  const fb: FakeBrowser = {
    popups: [],
    opened: [],
    assigned: [],
    replaced: [],
    log: [],
    storages: { sessionStorage: new FakeStorage(), localStorage: new FakeStorage() },
    storageCalls: [],
    listeners: new Set(),
    href: options.href ?? `${PAGE_ORIGIN}/events?page=2#top`,
    send(event) {
      for (const l of [...fb.listeners]) l(event);
    },
    env: undefined as unknown as BrowserEnv,
  };
  const crypto = options.crypto === undefined ? fakeCrypto : options.crypto;
  const logged: CryptoLike | null = crypto && {
    getRandomValues: (a) => crypto.getRandomValues(a),
    subtle: {
      digest: (alg, data) => {
        fb.log.push('digest');
        return crypto.subtle.digest(alg, data);
      },
    },
  };
  fb.env = {
    origin: new URL(fb.href).origin,
    href: () => fb.href,
    assign: (url) => {
      fb.assigned.push(url);
    },
    replaceState: (url) => {
      fb.log.push('replaceState');
      fb.replaced.push(url);
      fb.href = url;
    },
    open: (url) => {
      fb.log.push('open');
      fb.opened.push(url);
      if (options.block) return null;
      const p = new FakePopup();
      fb.popups.push(p);
      return p;
    },
    onMessage: (l) => {
      fb.listeners.add(l);
      return () => fb.listeners.delete(l);
    },
    crypto: logged,
    storage: (kind) => {
      fb.storageCalls.push(kind);
      return fb.storages[kind];
    },
  };
  return fb;
}

export interface ResSpec {
  status?: number;
  body?: unknown;
}

/** A minimal Response for the transport: status, ok, text(), headers. */
export function res(status: number, body?: unknown): Response {
  const text = body === undefined ? '' : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, headers: new Headers(), text: async () => text } as unknown as Response;
}

export const tokenBody = (expiresAt: string | number = Date.now() + 3600_000) => ({
  token: TOKEN,
  expiresAt: typeof expiresAt === 'number' ? new Date(expiresAt).toISOString() : expiresAt,
  visitor: VISITOR,
});

export function setup(opts: { fb?: FakeBrowser; session?: SessionPersistence; fetch?: ReturnType<typeof vi.fn> } = {}) {
  const fb = opts.fb ?? fakeBrowser();
  const fetchImpl = opts.fetch ?? vi.fn<typeof fetch>();
  const wrapped = ((...args: Parameters<typeof fetch>) => {
    fb.log.push('fetch');
    return (fetchImpl as unknown as typeof fetch)(...args);
  }) as typeof fetch;
  const transport = createTransport({ baseUrl: BASE, key: { header: 'X-Community-Key', value: KEY }, locale: 'en', fetch: wrapped });
  const auth = createAuth(transport, KEY, 'en', opts.session ?? 'memory', () => fb.env);
  const attendance = createAttendance(transport, auth.session, 'en');
  return { fb, fetch: fetchImpl as ReturnType<typeof vi.fn<typeof fetch>>, auth: auth.api, session: auth.session, attendance };
}

export const flush = async (n = 50) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/** Waits until the popup has been sent to /connect, and returns that URL. */
export async function connectUrlOf(popup: FakePopup): Promise<URL> {
  for (let i = 0; i < 20 && popup.hrefs.length === 0; i++) await flush();
  expect(popup.hrefs).toHaveLength(1);
  return new URL(popup.hrefs[0]);
}

/** A message as /connect posts it, from the given popup. */
export function connectMessage(popup: FakePopup, state: string, extra: Record<string, unknown>): MessageLike {
  return { origin: CONNECT_ORIGIN, source: popup, data: { type: 'unihub:connect', state, ...extra } };
}

/** Full popup sign-in against a mocked /connect/token. */
export async function signInWithPopup(t: ReturnType<typeof setup>, body: unknown = tokenBody()) {
  t.fetch.mockResolvedValueOnce(res(200, body));
  const p = t.auth.signIn();
  const popup = t.fb.popups[t.fb.popups.length - 1];
  const url = await connectUrlOf(popup);
  t.fb.send(connectMessage(popup, url.searchParams.get('state') as string, { code: 'uhcc_one_time' }));
  return { visitor: await p, popup, url };
}

/** (j): no URL the SDK opened, assigned, replaced or fetched carries a session token. */
export function expectNoTokenInUrls(t: ReturnType<typeof setup>) {
  const urls = [
    ...t.fb.opened,
    ...t.fb.popups.flatMap((p) => p.hrefs),
    ...t.fb.assigned,
    ...t.fb.replaced,
    ...t.fetch.mock.calls.map((c) => String(c[0])),
  ];
  for (const u of urls) expect(u).not.toContain('uhct_');
}
