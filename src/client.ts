import type { UniHubConfig, UniHub } from './types';
import { UniHubError } from './errors';
import { DEFAULT_LOCALE, type Locale } from './i18n';
import { createTransport } from './transport';
import { createEvents } from './events';
import { createAuth } from './auth';
import { createAttendance } from './attendance';

export const DEFAULT_BASE_URL = 'https://api.unihub.tr/api/v1/community';

function checkBaseUrl(raw: string, locale: Locale): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UniHubError('INVALID_ARGUMENT', 0, { locale, message: `unihub-community-sdk: baseUrl is not a URL: ${raw}` });
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new UniHubError('INVALID_ARGUMENT', 0, {
      locale,
      message: `unihub-community-sdk: baseUrl must use https (http is allowed only for localhost): ${raw}`,
    });
  }
  return raw.replace(/\/+$/, '');
}

/**
 * Entry point for a community website: `createUniHub({ key: 'uhpk_live_…' })`.
 * Reads are anonymous — the key names the club, and only its public events are visible.
 */
export function createUniHub(config: UniHubConfig): UniHub {
  const locale = config?.locale ?? DEFAULT_LOCALE;
  const key = config?.key;
  if (!key) {
    throw new UniHubError('INVALID_ARGUMENT', 0, { locale, message: "unihub-community-sdk: 'key' is required." });
  }
  if (typeof key !== 'string' || !key.startsWith('uhpk_')) {
    throw new UniHubError('INVALID_ARGUMENT', 0, {
      locale,
      message: "unihub-community-sdk: 'key' must be a publishable community key (uhpk_…). Never put a master key or any other secret in a web page.",
    });
  }
  const persistence = config.session ?? 'memory';
  if (persistence !== 'memory' && persistence !== 'sessionStorage' && persistence !== 'localStorage') {
    throw new UniHubError('INVALID_ARGUMENT', 0, {
      locale,
      message: "unihub-community-sdk: 'session' must be 'memory', 'sessionStorage' or 'localStorage'.",
    });
  }
  const transport = createTransport({
    baseUrl: checkBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL, locale),
    key: { header: 'X-Community-Key', value: key },
    locale,
    fetch: config.fetch,
  });
  // Nothing here touches window, storage or timers: auth resolves the browser on first use.
  const auth = createAuth(transport, key, locale, persistence);
  return {
    events: createEvents(transport, locale),
    auth: auth.api,
    attendance: createAttendance(transport, auth.session, locale),
  };
}
