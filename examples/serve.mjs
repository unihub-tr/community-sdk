// Dependency-free static server for the example site: http://localhost:5173
//   /            → examples/vanilla/
//   /dist/...    → dist/ (run `npm run build` first)
//   /cdn/        → examples/cdn/ (loads the published SDK from jsDelivr)
//   /starter/    → starter/index.html with the SDK served from /dist/ (same integrity, so the
//                  local build must match it), CONFIG.key from ?key= and CONFIG.clubName from ?name= (dev only).
//                  ?mock=1 points the page at /mock-api/ instead of UniHub (no key needed).
//   /mock-api/   → a fake, read-only events API with every display variant (image / no image,
//                  location / none, form / none, past), for screenshots of states production lacks.
// The port matters: the backend checks the page's origin against the key's allowed origins.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 5173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.map': 'application/json' };

function resolve(pathname) {
  // /dist/… → the local build; /cdn/ → the CDN example (loads the published file from jsDelivr); else the vanilla example.
  const [base, rest] = pathname.startsWith('/dist/')
    ? ['dist', pathname.slice(6)]
    : pathname.startsWith('/cdn/')
      ? [join('examples', 'cdn'), pathname.slice(5) || 'index.html']
      : [join('examples', 'vanilla'), pathname.slice(1) || 'index.html'];
  const dir = join(ROOT, base);
  const file = normalize(join(dir, rest));
  return file.startsWith(dir + sep) ? file : null;
}

const SDK_CDN = /https:\/\/cdn\.jsdelivr\.net\/npm\/unihub-community-sdk@[^/"]+\/dist\/index\.global\.js/;
const KEY_PLACEHOLDER = "key: 'uhpk_live_BURAYA_ANAHTARINIZ'";
const NAME_PLACEHOLDER = "clubName: 'Kulübünüzün Adı'";
const CREATE = 'UniHub.createUniHub({ key: CONFIG.key,';

// Fake events for /mock-api/ (dev only). Image from a pinned public CDN file.
const IMG = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f389.png';
const base = { capacity: null, membersOnly: false, verifiedOnly: false, approvalRequired: false, requiresForm: false, status: 'UPCOMING', description: 'Açıklama satırı 1\nAçıklama satırı 2' };
const MOCK_EVENTS = [
  { ...base, id: 1, title: 'Görselli, yerli, formlu', startsAt: '2026-12-01T19:00:00+03:00', registrationDeadline: '2026-11-30T23:59:00+03:00', location: 'Konferans Salonu', imageUrl: IMG, requiresForm: true, approvalRequired: true },
  { ...base, id: 2, title: 'Görselsiz, yersiz, formsuz', startsAt: '2026-12-02T19:00:00+03:00', registrationDeadline: null, location: null, imageUrl: null },
  { ...base, id: 3, title: 'Görselsiz, yerli, formlu, üyelere', startsAt: null, registrationDeadline: null, location: 'Kampüs', imageUrl: null, requiresForm: true, membersOnly: true, verifiedOnly: true, description: '' },
  { ...base, id: 4, title: 'Görselli, yersiz, formsuz', startsAt: '2026-12-04T19:00:00+03:00', registrationDeadline: '2026-12-04T19:00:00+03:00', location: null, imageUrl: IMG },
  { ...base, id: 5, title: 'Geçmiş etkinlik', startsAt: '2026-10-01T19:00:00+03:00', registrationDeadline: '2026-10-01T19:00:00+03:00', location: 'Eski Salon', imageUrl: null, status: 'PAST' },
];
const summary = ({ id, title, startsAt, location, imageUrl, status, registrationDeadline }) => ({ id, title, startsAt, location, imageUrl, status, registrationDeadline });

function mockApi(url, res) {
  const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const m = /^\/mock-api\/events(?:\/(\d+))?$/.exec(url.pathname);
  if (!m) return json(404, { code: 'EVENT_NOT_FOUND', message: 'not found' });
  if (m[1]) {
    const e = MOCK_EVENTS.find((x) => x.id === Number(m[1]));
    return e ? json(200, e) : json(404, { code: 'EVENT_NOT_FOUND', message: 'Etkinlik bulunamadı.' });
  }
  const when = url.searchParams.get('when') === 'past' ? 'PAST' : 'UPCOMING';
  const items = MOCK_EVENTS.filter((e) => e.status === when).map(summary);
  return json(200, { items, page: 0, size: 20, totalItems: items.length, totalPages: items.length ? 1 : 0 });
}

// The starter template as a club would deploy it, except that the SDK comes from the local build and
// the key from the URL. Only a well-formed publishable key is injected, so nothing else reaches the page.
async function starter(url, res) {
  let html = await readFile(join(ROOT, 'starter', 'index.html'), 'utf8');
  html = html.replace(SDK_CDN, '/dist/index.global.js');
  const key = url.searchParams.get('key') ?? '';
  if (/^uhpk_[A-Za-z0-9_]+$/.test(key)) html = html.replace(KEY_PLACEHOLDER, `key: '${key}'`);
  // The name becomes a JSON string literal with '<' escaped, so it cannot end the script element.
  const name = (url.searchParams.get('name') ?? '').slice(0, 80);
  if (url.searchParams.get('mock') === '1') {
    html = html.replace(KEY_PLACEHOLDER, "key: 'uhpk_live_mock'").replace(CREATE, `UniHub.createUniHub({ baseUrl: 'http://localhost:${PORT}/mock-api', key: CONFIG.key,`);
  }
  if (name) html = html.replace(NAME_PLACEHOLDER, () => `clubName: ${JSON.stringify(name).replace(/</g, '\\u003c')}`);
  res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.end(html);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/mock-api/')) return mockApi(url, res);
  if (url.pathname === '/starter/' || url.pathname === '/starter/index.html') {
    try {
      return await starter(url, res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
  }
  if (url.pathname.startsWith('/starter/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
  }
  const file = resolve(decodeURIComponent(url.pathname));
  try {
    if (!file) throw new Error('outside root');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}).listen(PORT, 'localhost', () => console.log(`example site: http://localhost:${PORT}/  (key: ?key=uhpk_… or the input box)`));
