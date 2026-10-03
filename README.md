# EthioAI Venture Website

Public website for **EthioAI Venture** — a static-first [Astro](https://astro.build) + TypeScript application.

> This repository is bootstrapped as the G1 foundation (Linear **ENG-74**). Pages, design
> system, content and quality gates are delivered by subsequent Linear issues. See the
> approved specifications in Notion (Master Implementation Specification) for the full V1
> scope and non-goals.

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
locally in one go. `check:dist` inspects the generated markup outside inline
`<script>` bodies, HTML comments and inert/raw-text bodies —
`<style>`/`<template>`/`<textarea>`/`<noscript>` for every check, plus
`<title>` for all but its own check — for static accessibility/SEO problems
(`<html lang>` with a value read off the document's first `<html>` tag,
non-empty head `<title>` (an `<svg><title>` label doesn't count) and meta
description, viewport, exactly one `<h1>` per page — attribute values are
blanked first and inert/raw-text containers excluded, so a literal `<h1>`
inside a value, `<template>`, `<textarea>`, `<style>`, `<title>` or
`<noscript>` can't fake or hide the count; quoted or unquoted HTML5 attribute
forms, whitespace around `=`, tag and attribute names matched
case-insensitively, and the html/title/meta/base open tags matched
quote-aware — `>` inside a quoted attribute value never splits the match)
and validates that every internal `href`/`src`/`srcset`
reference (including SVG `xlink:href`) — matched only on parsed tag fragments,
so prose or code samples that merely mention `href="/…"` never count as links —
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
`data:` URI are under-checked instead), references carrying an undecodable
named HTML entity (the full entity table would be a dependency), and absolute
scheme-bearing URLs such as canonical/OG links (external, not validated).
CSS-internal `url()` references are not yet validated. Responsive,
interaction, performance and production-like QA stay manual — Linear
**ENG-86**.

Every edge-case verdict above is locked by a committed regression battery —
`npm test` runs `tests/check-dist.test.mjs` (built-in `node:test`, zero
dependencies) together with the route-pattern suite, wired into both
`npm run verify` and the CI job.

Action update policy: GitHub-owned actions (`actions/*`) float on mutable major tags;
third-party actions (the OpenCode review action) are pinned to a full commit SHA with a
version comment. Dependabot (`.github/dependabot.yml`) updates both weekly.

## Repository structure

```text
public/assets/      static assets
src/components/     reusable Astro components
src/content/        content collections (added by ENG-76)
src/config/         site configuration
src/layouts/        page layouts
src/pages/          routes
src/styles/         global styles
tests/              node:test regression suites (route patterns, check:dist)
```

## Conventions

- Work happens on feature branches tied to a Linear issue identifier; open a PR against
  `main` — never push directly to `main`.
- Follow `AGENTS.md` (implementation contract) and the factory rules in `.factory/`.
- V1 non-goals: no database, CMS, authentication, backend, CRM or chatbot.
