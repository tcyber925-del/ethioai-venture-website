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
npm run build          # production build
```

Run everything at once:

```sh
npm run verify
```

To auto-fix formatting:

```sh
npm run format
```

The same commands run in CI via GitHub Actions (`.github/workflows/ci.yml`). Additional
quality gates (content-schema validation, accessibility/SEO checks) are added by Linear
**ENG-87** — this workflow intentionally contains only the bootstrap checks from **ENG-74**.

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
