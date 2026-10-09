# Project status

**Last updated:** 2026-10-06 (Linear **ENG-101**)
**Milestone:** V1 — shipped and verified in production on 2026-10-05
**Live origin:** `https://ethioai-venture-website.tcyber925.workers.dev`

This page records where the project actually stands. It is a snapshot, not a contract:
the approved requirements live in Notion (MIS v1.0 and specifications 01–06) and the
executable acceptance criteria live in Linear. Numbers below were measured by running the
commands shown, not copied from an earlier report.

## Where V1 stands

V1 is complete and released. Every phase gate closed:

| Phase                        | Scope                                                                    | State                                          |
| ---------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| G0 — Product & Specification | PRD, IA/UX spec, technical architecture, MIS v1.0, repository boundary   | Done (ENG-71 … ENG-74, ENG-90, ENG-91)         |
| G1 — Foundation              | Repo bootstrap, design tokens, content collections, site shell, CI gates | Done (ENG-74 … ENG-77, ENG-87, ENG-94, ENG-97) |
| G2 — Core Pages              | Home, solutions, work, research, about (index + detail)                  | Done (ENG-78 … ENG-82)                         |
| G3 — Conversion & Quality    | Start a Project form, SEO, analytics, integrated QA                      | Done (ENG-83 … ENG-86)                         |
| G4 — Release                 | Deploy and production verification, release notes and retrospective      | Done (ENG-88, ENG-89)                          |

Linear project **P-ENG-6** has 23 issues, all Done. Follow-ups raised during the release
wave — ENG-95 (work-page regression gate), ENG-97 (content slug enforcement), ENG-100
(EthioSci entry and demo/GitHub event verification) — are also Done.

## Git state

- **`main`** — `fd46407`, "ENG-95: Add dependency-free regression checks for Work page in verify (#19)"
- **24 pull requests, all merged**, none open. Merges are squashed, so feature branches are
  not ancestors of `main`; each PR's identity is preserved in the commit subject line.
- **12 feature branches still exist on the remote** and all their work is merged. Deleting
  them is a mechanical cleanup, not outstanding engineering work.

## Verification, measured on `main` at `fd46407`

```sh
npm run verify
```

| Check                                 | Result                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `format:check` / `lint` / `typecheck` | pass                                                                                |
| `npm test`                            | **314 tests, 28 suites, 0 failures**                                                |
| `astro sync`                          | pass (collection schemas valid)                                                     |
| `npm run build`                       | **14 pages**                                                                        |
| `npm run check:dist`                  | 14 pages, 251 internal references, 0 problems, analytics enabled (`ethioaiventure`) |
| `npm run check:seo`                   | 14 pages, 13 sitemap URLs, 0 problems                                               |
| `npm run check:work`                  | 2 hide rules across 15 CSS sources, 3 routes present                                |

Nine `node:test` suites carry the regression contracts: `analytics`, `analytics-client`,
`check-dist`, `check-seo`, `check-work`, `content-slugs`, `route-patterns`,
`site-assets` and `start-a-project`.

**Two build warnings are expected, not defects:** the `research` collection is empty by
evidence policy, so Astro warns `The collection "research" does not exist or is empty`
several times per build.

### Shipped surface

Thirteen indexable pages plus a 404. The sitemap carries 13 URLs: `/`, `/solutions/`
(+ 5 detail pages), `/work/` (+ `/work/ethiobio/`, `/work/ethiosci/`), `/research/`,
`/about/` and `/start-a-project/`.

## Production verification (2026-10-05)

Recorded in Notion "08 — V1 Release Notes and Retrospective" §3, including the artifact
md5 match against the local build, the branded 404, the Formspree submission returning
`{"next":"/thanks","ok":true}`, and each analytics event firing from in-content clicks while
the same links in header and footer fire nothing. Nothing in this repository has been
re-verified against the live origin since 2026-10-05.

## Open follow-ups

| Item                                                     | State                                                                                                                                                    | Owner                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Research content                                         | Closed as won't-do by decision (2026-10-05). The collection stays empty rather than inventing entries.                                                   | Founder                 |
| Custom domain                                            | Closed by decision (2026-10-05): not purchasing one. Attaching later is a one-line change to `site.url` plus one re-verification pass.                   | Founder                 |
| ENG-96 — Work status taxonomy and project image metadata | Backlog. Change request from ENG-80's advisory review; V1 shipped with `status` as a validated free-text string and filter chips derived at render time. | Founder                 |
| Delete 12 merged remote branches                         | Open, mechanical.                                                                                                                                        | Anyone with push access |
| `og:image`                                               | Not built: no approved brand image exists.                                                                                                               | Founder                 |

## Known limitations

Carried from the release notes; none is a V1 defect.

- The origin is a provider subdomain rather than a brand domain, by decision.
- Deploys are manual by design. `npm run verify` must exit 0 before `npx wrangler deploy`,
  and no CI job deploys.
- Lab Lighthouse scores of 62–75 were read as an artifact of an idle test host and have
  not been re-measured under load.
- The favicon sits outside the hashed-asset directory, so a redeploy does not invalidate a
  browser's cached copy.
- `research-open` cannot fire: there is no in-content research link to click while the
  research collection is empty.
- Advisory PR review runs on a free-tier model whose rate limits the implementing agents
  hit repeatedly during the release wave.

## Lessons worth carrying forward

From the release retrospective, because they changed how this project is built:

1. **Green tests are not a working product.** The conversion funnel was dead with 284
   passing tests — the analytics client listened for a form hook attribute the form page
   never carried. Only driving the real artifact found it.
2. **Never encode a contract you have not exercised.** The form's success gate required a
   response field Formspree never returns, which would have failed every genuine inquiry.
3. **A platform migration changes defaults silently.** Cloudflare folding Pages into
   Workers kept the deploy command working while changing 404 behaviour underneath.
4. **Pin substantive guarantees, not incidental ones.** Asserting _which layer_ reported a
   duplicate slug made a test flaky and told a reader nothing; asserting the guarantee a
   reader relies on fixed both at once.
