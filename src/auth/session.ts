import type { SessionPersistence, Visitor } from '../types';
import type { BrowserEnv, StorageLike } from './browser';

/*
 * The visitor's session (BK-07: `uhct_…`, 1 h, no refresh). Memory by default; browser
 * storage only when the site opted in (SRS NFR-01). Storage is read lazily, on the first
 * auth / attendance call — never in createUniHub (rule 4).
 */

export interface Session {
  token: string;
  /** Epoch ms, from the server's `expiresAt`. */
  expiresAt: number;
  visitor: Visitor;
}

export interface SessionStore {
  /** The live session, or null. Notices an expiry the timer missed (throttled tab). */
  get(): Session | null;
  set(session: Session): void;
  /** Clears; with `token`, only if that is still the live session. Fires onChange(null) if one was live. */
  clear(token?: string): void;
  onChange(listener: (visitor: Visitor | null) => void): () => void;
}

/** Browsers fire a longer setTimeout at once (2^31 − 1 ms). */
const MAX_TIMER_MS = 2_147_483_647;

export function storageKey(key: string): string {
  return `unihub:session:${key}`;
}

export function isVisitor(v: unknown): v is Visitor {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.userId === 'number' &&
    typeof o.displayName === 'string' &&
    (o.avatarUrl === null || typeof o.avatarUrl === 'string') &&
    typeof o.emailVerified === 'boolean'
  );
}

function parse(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.token !== 'string' || !o.token.startsWith('uhct_')) return null;
    if (typeof o.expiresAt !== 'number' || !Number.isFinite(o.expiresAt)) return null;
    if (!isVisitor(o.visitor)) return null;
    return { token: o.token, expiresAt: o.expiresAt, visitor: o.visitor };
  } catch {
    return null;
  }
}

export function createSessionStore(
  key: string,
  persistence: SessionPersistence,
  getEnv: () => BrowserEnv | null
): SessionStore {
  const listeners = new Set<(visitor: Visitor | null) => void>();
  let loaded = false;
  let session: Session | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const storage = (): StorageLike | null => (persistence === 'memory' ? null : getEnv()?.storage(persistence) ?? null);

  function emit(visitor: Visitor | null): void {
    for (const l of [...listeners]) {
      try {
        l(visitor);
      } catch {
        // A site's listener must not break the SDK or the other listeners.
      }
    }
  }

  function disarm(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function arm(): void {
    disarm();
    if (!session) return;
    const token = session.token;
    timer = setTimeout(() => {
      timer = undefined;
      clear(token);
    }, Math.min(Math.max(0, session.expiresAt - Date.now()), MAX_TIMER_MS));
  }

  function write(s: Session | null): void {
    const st = storage();
    if (!st) return;
    try {
      if (s) st.setItem(storageKey(key), JSON.stringify(s));
      else st.removeItem(storageKey(key));
    } catch {
      // Quota or a blocked storage: the session still lives in memory.
    }
  }

  function load(): void {
    if (loaded) return;
    loaded = true;
    const st = storage();
    if (!st) return;
    let raw: string | null = null;
    try {
      raw = st.getItem(storageKey(key));
    } catch {
      return;
    }
    const s = parse(raw);
    if (!s || s.expiresAt <= Date.now()) {
      if (raw !== null) write(null);
      return;
    }
    session = s;
    arm();
  }

  function clear(token?: string): void {
    load();
    if (!session || (token !== undefined && session.token !== token)) return;
    session = null;
    disarm();
    write(null);
    emit(null);
  }

  return {
    get() {
      load();
      if (session && session.expiresAt <= Date.now()) clear(session.token);
      return session;
    },
    set(s) {
      load();
      session = s;
      write(s);
      arm();
      emit(s.visitor);
    },
    clear,
    onChange(listener) {
      load();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
