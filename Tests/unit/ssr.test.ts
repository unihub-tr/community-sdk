import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UniHubError } from '../../src/errors';

/*
 * (k) SSR: importing the SDK and calling createUniHub must not touch window, document,
 * location, storage or timers. Every such global is a throwing getter here.
 */

const TRAPPED = ['window', 'document', 'location', 'localStorage', 'sessionStorage', 'history', 'navigator'] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
const touched: string[] = [];

beforeEach(() => {
  touched.length = 0;
  for (const name of TRAPPED) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        touched.push(name);
        throw new Error(`SSR: ${name} touched`);
      },
    });
  }
  vi.resetModules();
});

afterEach(() => {
  for (const name of TRAPPED) {
    const d = saved.get(name);
    if (d) Object.defineProperty(globalThis, name, d);
    else delete (globalThis as Record<string, unknown>)[name];
  }
});

describe('SSR safety (rule 4)', () => {
  it('import + createUniHub (every session option) touch no browser global and start no timer', async () => {
    vi.useFakeTimers();
    try {
      const sdk = await import('../../src/index');
      for (const session of ['memory', 'sessionStorage', 'localStorage'] as const) {
        const unihub = sdk.createUniHub({ key: 'uhpk_live_ssr', session, fetch: vi.fn<typeof fetch>() });
        expect(typeof unihub.auth.signIn).toBe('function');
        expect(typeof unihub.attendance.join).toBe('function');
      }
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
    expect(touched).toEqual([]);
  });

  it('outside a browser: signIn rejects INVALID_ARGUMENT; current is null; handleRedirect is null', async () => {
    const sdk = await import('../../src/index');
    const fetchImpl = vi.fn<typeof fetch>();
    const unihub = sdk.createUniHub({ key: 'uhpk_live_ssr', session: 'localStorage', fetch: fetchImpl });
    const e = await unihub.auth.signIn().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(sdk.UniHubError); // the re-imported module's class
    expect((e as UniHubError).code).toBe('INVALID_ARGUMENT');
    expect(unihub.auth.current()).toBeNull();
    expect(await unihub.auth.handleRedirect()).toBeNull();
    expect(((await unihub.attendance.join(1).catch((x: unknown) => x)) as UniHubError).code).toBe('NOT_SIGNED_IN');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
