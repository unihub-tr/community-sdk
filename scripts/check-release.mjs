#!/usr/bin/env node
/*
 * Release gate (Phase 06). Run by `prepublishOnly` after the build; writes nothing.
 *
 *   node scripts/check-release.mjs             exit 0 ready · 1 a mismatch (each one listed)
 *   node scripts/check-release.mjs --print-sri print the SRI hash of dist/index.global.js
 *
 * Checks: package.json, SDK_VERSION, the top CHANGELOG entry and every README CDN URL name
 * the same version; the README's integrity attribute is the SHA-384 of the built CDN file;
 * examples/cdn/index.html carries the same version and hash; starter/index.html pins the same
 * version and hash, pins the QR library to QR_SCRIPT, loads nothing else, and contains no unsafe
 * DOM call, logging, persistent storage or real key, and inserts into the DOM only through its
 * put() helper (lines marked `// dom-insert-ok`); the tarball holds only dist/, starter/,
 * README, LICENSE, CHANGELOG and package.json; package.json's repository.url is the public
 * mirror exactly, which npm provenance requires (Phase 08).
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const CDN_FILE = 'dist/index.global.js';
const STARTER = 'starter/index.html';
// npm provenance requires repository.url to match the publishing repository exactly (case-sensitive).
const PUBLIC_REPO = 'git+https://github.com/unihub-tr/community-sdk.git';
// The QR library the starter template loads (plan Phase 07 D2); change both together.
const QR_SCRIPT = {
  src: 'https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.js',
  integrity: 'sha384-e9EFD6BGC90bkW9aDV5xbbBfzwN7G8YImHao2lfLVKV/hPB0E0go+H3I64h7oHtA',
};

function sri() {
  const path = join(root, CDN_FILE);
  if (!existsSync(path)) throw new Error(`${CDN_FILE} is missing: run npm run build first.`);
  return `sha384-${createHash('sha384').update(readFileSync(path)).digest('base64')}`;
}

if (process.argv.includes('--print-sri')) {
  console.log(sri());
  process.exit(0);
}

const problems = [];
const pkg = JSON.parse(read('package.json'));
const version = pkg.version;

if (pkg.repository?.url !== PUBLIC_REPO) problems.push(`package.json repository.url is ${JSON.stringify(pkg.repository?.url)}, not ${PUBLIC_REPO}.`);

const sdkVersion = /SDK_VERSION = '([^']+)'/.exec(read('src/version.ts'))?.[1];
if (sdkVersion !== version) problems.push(`src/version.ts says ${sdkVersion}, package.json says ${version}.`);

const changelog = /^## \[([^\]]+)\]/m.exec(read('CHANGELOG.md'))?.[1];
if (changelog !== version) problems.push(`the top CHANGELOG entry is ${changelog}, package.json says ${version}.`);

const readme = read('README.md');
const cdn = [...readme.matchAll(/cdn\.jsdelivr\.net\/npm\/unihub-community-sdk@([^/"'\s]+)/g)].map((m) => m[1]);
if (cdn.length === 0) problems.push('the README has no jsDelivr URL.');
for (const v of cdn) if (v !== version) problems.push(`a README CDN URL pins ${v}, package.json says ${version}.`);
if (/unihub-community-sdk@latest|unihub-community-sdk\/dist/.test(readme)) problems.push('a README CDN URL is not pinned to an exact version.');

const integrity = (text) => [...text.matchAll(/integrity="(sha384-[A-Za-z0-9+/=]+)"/g)].map((m) => m[1]);
const hashes = integrity(readme);
// The CDN example page must carry the same pinned URL and hash as the README.
const example = read('examples/cdn/index.html');
for (const v of [...example.matchAll(/unihub-community-sdk@([^/"'\s]+)/g)].map((m) => m[1])) {
  if (v !== version) problems.push(`examples/cdn/index.html pins ${v}, package.json says ${version}.`);
}
let built;
try {
  built = sri();
} catch (e) {
  problems.push(e.message);
}
if (hashes.length === 0) problems.push('the README CDN snippet has no integrity="sha384-…" attribute.');
for (const h of hashes) if (built && h !== built) problems.push(`the README integrity is ${h}, the built ${CDN_FILE} is ${built}.`);
const exampleHashes = integrity(example);
if (exampleHashes.length === 0) problems.push('examples/cdn/index.html has no integrity attribute.');
for (const h of exampleHashes) if (built && h !== built) problems.push(`examples/cdn/index.html integrity is ${h}, the built ${CDN_FILE} is ${built}.`);

// The starter template: what a club deploys must load exactly the published SDK and QR library.
if (!existsSync(join(root, STARTER))) {
  problems.push(`${STARTER} is missing.`);
} else {
  const starter = read(STARTER);
  const scripts = [...starter.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]).filter((a) => /\bsrc=/.test(a));
  const attr = (a, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(a)?.[1];
  const sdkSrc = `https://cdn.jsdelivr.net/npm/unihub-community-sdk@${version}/dist/index.global.js`;
  if (scripts.length !== 2) problems.push(`${STARTER} loads ${scripts.length} external scripts; expected 2 (the SDK and the QR library).`);
  const sdkTag = scripts.find((a) => attr(a, 'src')?.includes('unihub-community-sdk'));
  const qrTag = scripts.find((a) => attr(a, 'src') === QR_SCRIPT.src);
  if (!sdkTag) problems.push(`${STARTER} does not load the SDK.`);
  else {
    if (attr(sdkTag, 'src') !== sdkSrc) problems.push(`${STARTER} loads ${attr(sdkTag, 'src')}; expected ${sdkSrc}.`);
    if (built && attr(sdkTag, 'integrity') !== built) problems.push(`${STARTER} SDK integrity is ${attr(sdkTag, 'integrity')}, the built ${CDN_FILE} is ${built}.`);
  }
  if (!qrTag) problems.push(`${STARTER} does not load ${QR_SCRIPT.src}.`);
  else if (attr(qrTag, 'integrity') !== QR_SCRIPT.integrity) problems.push(`${STARTER} QR integrity is ${attr(qrTag, 'integrity')}; expected ${QR_SCRIPT.integrity}.`);
  for (const a of scripts) if (attr(a, 'crossorigin') !== 'anonymous') problems.push(`${STARTER}: script ${attr(a, 'src')} has no crossorigin="anonymous".`);
  const banned = [
    [/innerHTML|outerHTML|insertAdjacentHTML|document\.write/, 'an HTML-injecting DOM call'],
    [/\beval\s*\(|new Function\s*\(/, 'eval / new Function'],
    [/console\./, 'a console call'],
    [/localStorage/, 'localStorage'],
    [/uhpk_(live|test)_[0-9a-f]{32}/, 'a real publishable key'],
  ];
  for (const [re, what] of banned) if (re.test(starter)) problems.push(`${STARTER} contains ${what}.`);
  // Every DOM insertion goes through the template's put() helper, which drops null/undefined; the
  // DOM's own append() prints them as text (the 0.1.1 "null" defect). Raw calls only on marked lines.
  starter.split('\n').forEach((line, i) => {
    if (/\.(append|prepend|replaceChildren|before|after|replaceWith)\s*\(/.test(line) && !line.includes('// dom-insert-ok')) {
      problems.push(`${STARTER}:${i + 1} inserts into the DOM without put(): ${line.trim().slice(0, 80)}`);
    }
  });
  // The shipped file carries the placeholder, so no key of any kind (publishable or master) is in it.
  if (!starter.includes("key: 'uhpk_live_BURAYA_ANAHTARINIZ'")) problems.push(`${STARTER}: CONFIG.key is not the placeholder 'uhpk_live_BURAYA_ANAHTARINIZ'.`);
}

const packed = JSON.parse(execSync('npm pack --dry-run --json --ignore-scripts', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const files = packed[0].files.map((f) => f.path);
const allowed = (f) => f.startsWith('dist/') || f === STARTER || ['README.md', 'LICENSE', 'CHANGELOG.md', 'package.json'].includes(f);
for (const f of files) if (!allowed(f)) problems.push(`the tarball would include ${f}.`);
for (const f of ['README.md', 'LICENSE', 'CHANGELOG.md', STARTER, 'dist/index.mjs', 'dist/index.js', CDN_FILE, 'dist/index.d.ts', 'dist/index.d.mts']) {
  if (!files.includes(f)) problems.push(`the tarball is missing ${f}.`);
}

if (problems.length) {
  console.error(`check-release: ${problems.length} problem(s) for ${pkg.name}@${version}`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check-release: ${pkg.name}@${version} ready — ${files.length} files, ${built}`);
