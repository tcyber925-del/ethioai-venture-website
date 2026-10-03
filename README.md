# EthioAI Venture Website

Public website for **EthioAI Venture** — a static-first [Astro](https://astro.build) + TypeScript application.

> This repository is bootstrapped as the G1 foundation (Linear **ENG-74**). Pages, design
> system, content and quality gates are delivered by subsequent Linear issues. See the
> approved specifications in Notion (Master Implementation Specification) for the full V1
> scope and non-goals.

## Prerequisites

- Node.js `>= 20`
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
`<script>` bodies and HTML comments for static accessibility/SEO problems
(`<html lang>` with a value, non-empty `<title>` and meta description, viewport,
exactly one `<h1>` per page — attribute values are blanked first so a literal
`<h1>` inside a value can't fake the count; quoted or unquoted HTML5 attribute
forms, whitespace around `=`, tag and attribute names matched
case-insensitively) and validates that every internal `href`/`src`/`srcset`
reference (including SVG `xlink:href`) — root-relative or relative (resolved
against `<base href>` when the document declares one; an offsite `<base>` sends
both offsite, matching browser resolution, and fragment-only references become
checkable paths under a declared `<base>`), leading/trailing whitespace
trimmed, query/fragment stripped, percent-encoded paths and numeric HTML
entities decoded — resolves to a built file: zero dead internal links.
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
```

## Conventions

- Work happens on feature branches tied to a Linear issue identifier; open a PR against
  `main` — never push directly to `main`.
- Follow `AGENTS.md` (implementation contract) and the factory rules in `.factory/`.
- V1 non-goals: no database, CMS, authentication, backend, CRM or chatbot.
