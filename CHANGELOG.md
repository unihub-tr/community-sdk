# Changelog

All notable changes to `unihub-community-sdk` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/). While the version is `0.x`, a minor release
(`0.2.0`) may contain breaking changes; each one is listed here.

## [0.1.3] — 2026-11-07

No API change.

### Changed

- Published from GitHub Actions with npm provenance: each version links to the public commit it
  was built from, at https://github.com/unihub-tr/community-sdk.
- `package.json` names that repository (`repository`, `bugs`, `homepage`).

## [0.1.2] — 2026-11-07

No API change. Use this version of the starter template, not 0.1.1.

### Fixed

- Starter template: an event without an image showed the text "null" above its title.
  Every piece of the page is now added through one helper that skips empty values, and
  the release check refuses any other way of adding content.

## [0.1.1] — 2026-11-07

No API change.

### Added

- `starter/index.html`: a ready club website in one file, with no build step. It lists the
  club's events, shows their details, signs visitors in with UniHub, and lets them join,
  apply and see their ticket as a QR code. Both scripts are pinned with `integrity`. Set the
  key, name, colours and logo at the top; deployment steps are in the file and the README.

## [0.1.0] — 2026-11-07

First public release.

### Added

- `createUniHub({ key })` with a publishable, origin-bound community key (`uhpk_…`).
- `events.list({ when, page, size })` and `events.get(id)` for the club's public events.
- Sign-in with UniHub on UniHub's own page (`https://www.unihub.tr/connect`): popup by
  default, redirect as a fallback, PKCE. `auth.signIn`, `auth.register`,
  `auth.handleRedirect`, `auth.current`, `auth.onChange`, `auth.signOut`. The session is kept in memory unless
  the site opts in to `sessionStorage` or `localStorage`, and lasts one hour.
- Attendance on the visitor's session: `join`, `status`, `leave`, `ticket` (the QR
  payload, for the site to draw; never cached or logged by the SDK), `form` and `apply`.
- Typed errors: `UniHubError` with a stable `code` (20 codes) and a Turkish or English
  `message`.
- Three builds: ESM, CommonJS and a `<script>` build exposing `window.UniHub`, with
  TypeScript types for both module formats.

### Removed

- The pre-release `UniHubClient` class and per-event keys (`uevk_…`). They were never
  published; use `createUniHub` with a community key.

[0.1.0]: https://www.npmjs.com/package/unihub-community-sdk/v/0.1.0
