#!/usr/bin/env node
/**
 * Cuts one release into the public mirror (unihub-tr/community-sdk). Dev tool, not published.
 *
 *   node scripts/mirror-cut.mjs --mirror <local clone of the public repo>
 *
 * Copies the allowlisted files, as committed at the tagged HEAD, into the mirror's working tree,
 * deletes mirror files the allowlist no longer has, writes the mirror's own .gitattributes, and
 * stages the result. It never commits or pushes: the release commit is made by hand after the
 * mirror's own fresh-clone checks, and the user pushes.
 *
 * Before writing anything it refuses (exit 2) unless the source tree is clean, HEAD carries the
 * tag v<package version>, and the mirror is a clean clone whose origin is the public repo. It
 * fails (exit 1) if the cut would contain a private path or a key, session, token, local path
 * or personal address.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_REPO = 'unihub-tr/community-sdk';

// What the mirror carries (plan Phase 08 D2). Everything else stays private.
const ALLOW_DIRS = ['src/', 'Tests/unit/', 'Tests/contract/', 'scripts/', 'examples/', 'starter/', '.github/workflows/'];
const ALLOW_FILES = ['README.md', 'CHANGELOG.md', 'LICENSE', 'package.json', 'package-lock.json', 'tsup.config.ts', '.nvmrc', '.gitignore'];
const ALLOW_PATTERNS = [/^tsconfig[^/]*\.json$/, /^vitest[^/]*\.config\.ts$/];

// Never in the mirror, whatever the allowlist says.
const PRIVATE = /^(AgentReports|ImplementationPlans|DBL|Tools|\.claude)\/|^(CLAUDE\.md|AGENTS\.md)$|^nissth-bridge/;

// Never in any mirror file. This script is itself in the cut, so a pattern whose own source
// text would match it is assembled from pieces.
const j = (...parts) => parts.join('');
const SECRETS = [
  [/uhpk_live_[0-9a-f]{32}/, 'a live community key'],
  [new RegExp(j('uh', 'mk_')), 'a master key prefix'],
  [/uhct_[A-Za-z0-9]{20,}/, 'a visitor session'],
  [/npm_[A-Za-z0-9]{36}/, 'an npm token'],
  [/C:\\\\?Users/i, 'a local Windows path'],
  [new RegExp(j('Uc', 'maz|umut', 'brkt'), 'i'), 'a personal name or address'],
];

// The mirror's line-ending policy, generated rather than copied (plan Phase 08 A2).
const GITATTRIBUTES = `# Line endings: LF in the repository and in every checkout.
* text=auto eol=lf

# Never run text filters over binaries.
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.ico binary
*.pdf binary
`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (cwd, args, opts = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const refuse = (why) => { console.error(`mirror-cut: refused — ${why}`); process.exit(2); };
const fail = (problems) => { console.error(`mirror-cut: FAILED — nothing written\n- ${problems.join('\n- ')}`); process.exit(1); };

// ---- arguments and preconditions ----------------------------------------------------------
const at = process.argv.indexOf('--mirror');
if (at < 0 || !process.argv[at + 1]) refuse('usage: node scripts/mirror-cut.mjs --mirror <dir>');
const mirror = resolve(process.argv[at + 1]);

if (git(root, ['status', '--porcelain']).trim()) refuse('the source tree has uncommitted changes');
const version = JSON.parse(git(root, ['show', 'HEAD:package.json'])).version;
const tags = git(root, ['tag', '--points-at', 'HEAD']).split('\n').map((t) => t.trim());
if (!tags.includes(`v${version}`)) refuse(`HEAD is not tagged v${version}`);
const sourceSha = git(root, ['rev-parse', 'HEAD']).trim();

try { git(mirror, ['rev-parse', '--git-dir']); } catch { refuse(`${mirror} is not a git repository`); }
let origin = '';
try { origin = git(mirror, ['remote', 'get-url', 'origin']).trim(); } catch { /* no origin */ }
const want = new RegExp(`github\\.com[/:]${PUBLIC_REPO.replace('/', '\\/')}(\\.git)?/?$`);
if (!want.test(origin)) refuse(`the mirror's origin is "${origin || 'none'}", not ${PUBLIC_REPO}`);
if (resolve(git(mirror, ['rev-parse', '--show-toplevel']).trim()) === resolve(root)) refuse('the mirror is the source repository');
if (git(mirror, ['status', '--porcelain']).trim()) refuse('the mirror has uncommitted changes');

// ---- the cut, checked before anything is written ------------------------------------------
const allowed = (f) => ALLOW_DIRS.some((d) => f.startsWith(d)) || ALLOW_FILES.includes(f) || ALLOW_PATTERNS.some((p) => p.test(f));
const files = git(root, ['ls-files']).split('\n').filter(Boolean).filter(allowed);
const content = new Map(files.map((f) => [f, execFileSync('git', ['show', `HEAD:${f}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 })]));

const problems = [];
for (const f of files) if (PRIVATE.test(f)) problems.push(`${f}: private path`);
for (const [f, buf] of content) {
  const text = buf.toString('utf8');
  for (const [re, what] of SECRETS) if (re.test(text)) problems.push(`${f}: contains ${what}`);
}
for (const required of ['package.json', 'LICENSE', 'README.md', '.github/workflows/release.yml']) {
  if (!content.has(required)) problems.push(`${required}: missing from the cut`);
}
if (problems.length) fail(problems);

// ---- write --------------------------------------------------------------------------------
const keep = new Set([...files, '.gitattributes']);
for (const f of git(mirror, ['ls-files']).split('\n').filter(Boolean)) {
  if (!keep.has(f)) rmSync(join(mirror, f), { force: true });
}
for (const [f, buf] of content) {
  mkdirSync(dirname(join(mirror, f)), { recursive: true });
  writeFileSync(join(mirror, f), buf);
}
writeFileSync(join(mirror, '.gitattributes'), GITATTRIBUTES);
git(mirror, ['add', '-A']);

const changes = git(mirror, ['status', '--porcelain']).split('\n').filter(Boolean);
console.log(`mirror-cut: v${version} from source ${sourceSha.slice(0, 7)} → ${mirror}`);
console.log(`${files.length + 1} files in the cut; ${changes.length} change(s) staged:`);
for (const c of changes) console.log(`  ${c}`);
console.log(`Next: fresh checks in the mirror, then commit "Release ${version} (source ${sourceSha.slice(0, 7)})" and tag v${version}.`);
