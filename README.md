# EthioAI Venture Website

Public website for **EthioAI Venture** — a static-first [Astro](https://astro.build) + TypeScript application.

**Status: V1 shipped and verified in production on 2026-10-05**, deployed at
`https://ethioai-venture-website.tcyber925.workers.dev`. All 23 Linear issues of project
**P-ENG-6** (G0 specification through G4 release) are Done and 24 pull requests are merged.

For the current milestone, verification numbers and open follow-ups see
[`docs/STATUS.md`](docs/STATUS.md). The approved product and architecture record lives in
Notion ("00 — Master Implementation Specification v1.0" and specifications 01–06); what V1
deliberately excludes is listed under [V1 non-goals](#v1-non-goals).

## Prerequisites

- Node.js `>= 22.18` (`engines` floor — the wired test suite imports a
  `.ts` file, which Node executes natively only since 22.18's unflagged
  type stripping; CI runs the latest 22.x)
- npm (bundled with Node.js)

## Setup

```sh
npm install
```

## Development

```sh
npm run dev       # start the dev server
npm run build     # production build to dist/
npm run preview   # preview the production build locally
```

## What the site does

Thirteen indexable pages across six route families, all static HTML with minimal
JavaScript: home, `/solutions` plus five solution detail pages, `/work` plus project
detail pages, `/research`, `/about` and `/start-a-project`.

Three integrations are configured, each through a single config constant so a change
is one edit plus one re-verification pass:

- **Start a Project form** — Formspree hosted endpoint (`src/config/forms.ts`). A
  problem-first qualification form with native validation, client-side submit and
  live status/error regions, a no-JS native POST fallback, and two honeypot fields
  (the acceptance-criteria `_honey` plus Formspree's own `_gotcha`). Fields are
  limited to problem, name, email and an optional organization; no sensitive data is
  collected. V1 introduced no backend, database, CRM or authentication.
- **Analytics** — GoatCounter, cookieless (`src/config/analytics.ts`). Sends event
  names and page paths only: no form contents, no personal data, no persistent
  identifier, no client-side storage. Section-open events count in-content
  interactions only, so header and footer navigation never inflates engagement
  counts. `src/config/analytics.ts` holds the authoritative event catalog;
  `src/scripts/analytics-client.ts` is the DOM wiring behind `init(win, doc)`.
- **SEO** — canonical URLs, Open Graph and twitter cards, WebSite JSON-LD,
  `sitemap.xml`, `robots.txt` and a branded 404, all deriving from `site.url` in
  `src/config/site.ts`. Gated by `npm run check:seo`.

## Quality commands

These are the deterministic checks for this stage. They must pass before a pull request is
considered ready for review:

```sh
npm run format:check   # verify formatting (Prettier)
npm run lint           # lint (ESLint, flat config)
npm run typecheck      # TypeScript type check (astro check)
npm test               # node:test regression suites (tests/)
npx astro sync         # content-collection schema validation
npm run build          # production build
npm run check:dist     # static accessibility/SEO checks + internal link validation
npm run check:seo       # SEO head contract: titles, canonical, og/twitter, sitemap/robots, JSON-LD
npm run check:work      # /work regression gate: status-filter hide rules + expected pages in the built output
```

Run everything at once:

```sh
npm run verify
```

To auto-fix formatting:

```sh
npm run format
```

The same commands run in CI via GitHub Actions (`.github/workflows/ci.yml`) as the
required **Deterministic checks** status; `npm run verify` runs the identical set
locally in one go — both chains run the same steps in the same order and end with
`check:dist` followed by the `check:seo` head-contract gate
(`scripts/check-seo.mjs`) and then the `check:work` /work regression gate
(`scripts/check-work.mjs`). `check:dist` inspects the generated markup outside inline
`<script>`/`<iframe>`/`<object>` bodies (the tags stay — `src=`/`data=` is a
fetch target; iframe children live in a child document, object children are
failure-only fallback), HTML comments (the abrupt `<!-->`/`<!--->` forms and
`--!>` close at their `>`, unclosed ones run to EOF — like parsers),
`<![CDATA[…]]>` (a foreign-content text node — dropped to `]]>`),
`<?…>`/non-doctype `<!…>` bogus comments (dropped to their first `>`) and
inert/raw-text/non-rendered bodies —
`<style>`/`<template>`/`<textarea>`/`<noscript>`/`<xmp>`/`<noframes>` for
every check (`<plaintext>` never closes — EOF), plus
`<title>` for all but its own check (every drop comes from one quote-aware
token walk, so markup-shaped text inside a quoted attribute value can never
open or close a strip; an unclosed _container_ — malformed markup Astro never
emits — fails loudly rather than being guessed out) — for
static accessibility/SEO problems
(`<html lang>` with a value read off the document's first `<html>` tag,
non-empty head `<title>` (an `<svg>`/`<math>` `<title>` label never
counts — depth-tracked, so even a source-order-head foreign one is out)
and meta
description, viewport, exactly one `<h1>` per page — every structural
lookup runs over quote-aware tag fragments: values and attribute-shaped
prose can't fake a check, while a literal `<h1>` in text (which parsers
promote to a real heading) still counts, and inert/raw-text containers are
excluded, so a literal `<h1>` inside a value, `<template>`, `<textarea>`,
`<style>`, `<title>` or `<noscript>` can't fake or hide the count; an
`<svg>`/`<math>` `<h1>` counts too — h1–h6 are breakout elements in foreign
content, so the parser pops out and the heading lands as a real
`HTMLHeadingElement`, and an SVG `<title>` (an HTML integration point) is
scanned as markup, not dropped as raw text; quoted
or unquoted HTML5 attribute
forms, whitespace around `=`, tag and attribute names matched
case-insensitively — `>` inside a quoted attribute value never splits a
match, and markup inside another attribute's value (`content="<title>…"`)
is content, never structure)
and validates that every internal `href`/`src`/`srcset`/`<object data=…>`
reference (including SVG `xlink:href`) — matched only at real
attribute-name positions inside parsed tag fragments, so neither prose or
code samples nor attribute-shaped text inside quoted values
(`alt="use href=/x"`) ever count as links —
root-relative or relative (resolved
against `<base href>` when the document declares one; an offsite `<base>` sends
both offsite, matching browser resolution, and fragment-only references become
checkable paths under a declared `<base>`), leading/trailing whitespace
trimmed, query/fragment stripped, percent-encoded paths and numeric HTML
entities decoded, root-relative paths WHATWG-normalized (tab/LF/CR stripped,
`\` → `/`) — resolves to a built file: zero dead internal links.
Documented skips, all specified in the script header: `data:` payloads in
`srcset` (checking resumes only at path-prefixed tokens carrying neither
quotes nor markup, so base64/percent-encoded payloads cannot red the gate —
the residual is a raw unencoded payload fragment that is itself a clean path
token naming a missing file, which **can** red; bare-relative entries after a
`data:` URI are under-checked instead), references whose _pathname_ carries
an undecodable named HTML entity (the full entity table would be a
dependency — and the skip applies with or without the trailing `;`, since
browsers decode legacy no-semicolon forms too; the test runs on the
query/fragment-stripped path only, so `?…&utm_source=…` query text — which
never reaches the filesystem — is checked normally, round 19), the
non-`src`/`href` fetch attributes
`poster`/`action`/`formaction` (documented under-check — never red; no
forms or video in the site today), and absolute
scheme-bearing URLs such as canonical/OG links (external, not validated).
CSS-internal `url()` references are not yet validated. Responsive,
interaction, performance and production-like QA stay manual — Linear
**ENG-86**.

Every edge-case verdict above is locked by a committed regression battery —
`npm test` runs `tests/check-dist.test.mjs` (built-in `node:test`, zero
dependencies) together with the route-pattern, analytics and content-slug
uniqueness suites, plus the `check:seo` head-contract battery and the `check:work`
/work regression battery
(`tests/check-seo.test.mjs`), wired into both `npm run verify` and the CI job.
`check:dist` also asserts the **ENG-85 analytics build invariant** in both
directions from the site ID in `src/config/analytics.ts`: while it is empty no
text asset in `dist/` may carry a `goatcounter` / `gc.zgo.at` /
`data-analytics-event` byte, and once a site ID is set every page must carry the
count script (`ANALYTICS_SITE_ID` overrides the ID for the battery only — unset
in every documented command, and a mismatch between override and build can only
red the gate). Live-event verification with a real ID stays a browser pass —
Linear **ENG-85**.

Action update policy: GitHub-owned actions (`actions/*`) float on mutable major tags;
third-party actions (the OpenCode review action) are pinned to a full commit SHA with a
version comment. Dependabot (`.github/dependabot.yml`) updates both weekly.

## Deployment

The site is a static build served by **Cloudflare Workers static assets**
(Cloudflare migrated Pages into Workers; `wrangler pages deploy` now delegates
to a Workers deployment). Deploys are deliberately manual and run from a
CI-verified tree — there is no deploy automation in CI.

```bash
npm run verify          # must exit 0 before every deploy
npx wrangler deploy     # reads wrangler.jsonc; uploads ./dist
```

- **Origin (founder decision, 2026-10-04):** `https://ethioai-venture-website.tcyber925.workers.dev`.
  The previously planned `ethioai-venture-website.pages.dev` does not resolve.
  The origin that canonical URLs, `og:url`, the sitemap and robots derive from
  lives in one constant: `site.url` in `src/config/site.ts` — attaching a custom
  domain later is a one-line change there, followed by one re-verification pass.
- **`wrangler.jsonc`** — `assets.not_found_handling: "404-page"` is required:
  under Workers, serving the built `404.html` is opt-in, and the default
  answers unknown paths with an empty 404 body.
- **`public/_headers`** — `public, max-age=31536000, immutable` on `/_astro/*`
  only (content-hashed CSS/JS). Non-hashed `public/assets/` and HTML are
  deliberately excluded so they keep revalidating. Note the rule applies to
  _every_ matching response, so a 404 under `/_astro/` is also cached
  immutably; that is accepted because a content-hashed name that 404s never
  becomes valid again, and `check:dist` gates dead references at build time.
- **Verified with wrangler 4.147.0.** Wrangler is not a project dependency, so
  `npx wrangler` resolves to the latest release — if a future version changes
  assets or `_headers` handling, re-verify the table in Linear **ENG-88**.

## Repository structure

```text
public/             static assets, favicon, and the Workers _headers file
src/components/     reusable Astro components
src/content/        content collections (solutions, projects, research)
src/config/         site, analytics, form and route configuration
src/layouts/        page layouts
src/pages/          routes
src/scripts/        client-side TypeScript (analytics client)
src/styles/         design tokens and global styles
scripts/            build-output gates (check:dist, check:seo, check:work)
tests/              node:test regression suites
docs/               project documentation
```

`public/favicon.svg` and `public/favicon.ico` are shipped and linked from every page
(ENG-86). They sit outside the hashed `/_astro/` directory, so they keep the platform's
default caching: a redeploy does not invalidate a browser's cached copy, and a browser may
keep rendering the previous icon until its cache entry refreshes.

## Content authoring

Entries live in `src/content/<collection>/` (`solutions`, `projects`, `research`).
Every entry's frontmatter `slug` must:

- **Match `^[a-z0-9]+(?:-[a-z0-9]+)*$`** — lowercase letters, digits and single
  hyphens only (e.g. `workflow-automation`); no spaces and no leading, trailing
  or inner `/`. The slug is interpolated directly into the route
  (`/solutions/<slug>`, `/work/<slug>`, `/research/<slug>`) and into cross-page
  relation links; any other shape — including URL-safe ones such as `snake_case`
  or `Upper` — is rejected by the schema.
- **Be unique within its collection** — a duplicate does not fail the build:
  `astro sync` and `npm run build` still exit 0, one entry silently wins the
  route and the other's page is never written, while links resolve to the
  winner. Astro's duplicate _warning_ is not guaranteed — on a cold content
  store its concurrent loader can emit none at all — so the build stays silent
  and enforcement happens in `npm test` (below).

Both rules are enforced automatically (ENG-97): the pattern by the collection
schema in `src/content.config.ts` (`npx astro sync` and `npm run build` fail,
naming the offending entry), the uniqueness by
`tests/content-slugs.test.mjs` (`npm test`, part of `npm run verify` and the
CI "Deterministic checks" job). Uniqueness is detected by reconciling the
on-disk entries against Astro's parsed content store, and the failure names the
colliding slug and both files — attribution reads each file's own declared
slug, so the message does not depend on that loader warning.

## Conventions

- Work happens on feature branches tied to a Linear issue identifier; open a PR against
  `main` — never push directly to `main`.
- Follow `AGENTS.md` (implementation contract) and the factory rules in `.factory/`.

## V1 non-goals

No database, CMS, authentication, customer portal, CRM, chatbot or agent runtime, no
file uploads, no user accounts, no CI deploy automation, and no `og:image` (no approved
brand image exists). Do not introduce infrastructure beyond this list without approval.

The research collection is empty by evidence policy — Astro warns
`The collection "research" does not exist or is empty` on every build, and that is
expected. Fields stay empty until an approved source exists; nothing is invented to
fill a gap. The two shipped projects are EthioBio and EthioSci, both carried as
**In Development**: a tagged release and a live deployment are not proof of production
use.
