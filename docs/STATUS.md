# Project status

**Last updated:** 2026-10-13 (Linear **ENG-103**; Git state and ENG-103 section refreshed)
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

- **`main`** — `b2f7980`, "ENG-101: refresh README to shipped V1 state and add docs/STATUS.md (#25)"
- **27 pull requests** — 26 merged, 1 open (#27, the ENG-103 branch). Merges are squashed, so
  feature branches are not ancestors of `main`; each PR's identity is preserved in the commit
  subject line.
- **No stale feature branches remain on the remote** — only `main` and the open ENG-103 branch.
  The earlier 12-branch cleanup is complete.

## Verification (ENG-101 snapshot, 2026-10-13)

Measured when this page was created (#25). Numbers for the current tree — after ENG-102
added `check:fonts`/`check:pending` and ENG-103 added `check:a11y` — are **427 tests /
46 suites** (measured on the ENG-103 branch; the gates are listed in the ENG-103 section).

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
| Delete merged remote branches (was 12)                   | Done. `git ls-remote --heads origin` now returns only `main` and the open ENG-103 branch.                                                                | Anyone with push access |
| `og:image`                                               | Not built: no approved brand image exists.                                                                                                               | Founder                 |

### ENG-103 — Batch 2 accessibility and navigation polish

Recorded 2026-10-13. Of the seven items below: **two were fixed in code**, **one is a recorded
no-change decision**, **two are out of scope for Batch 3**, **one is a Change Request** (the chip
selected cue), and **one (AC11) could not be run**.
Only the two fixed items were defects introduced by ENG-103; the rest are reported, not fixed,
because the issue's explicit non-goals reserve whole-card work for Batch 3 — except the chip
selected cue, which the AC1 fix did change and which is escalated as a Change Request.

| Item                                                            | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Owner   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Work filter chip boundary (WCAG 1.4.11)                         | **Fixed.** The chip's default border moved from `--color-border` (1.42:1) to `--color-secondary` (7.81:1 on surface, 7.48:1 on the page neutral). No token changed; an approved colour was reused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Agent   |
| Nav list semantics, `aria-current="page"`, nav-link target size | **Fixed.** `role="list"` restored on the marker-stripped lists; the current page is marked on header/footer nav; nav links carry block padding for a ≥24×24 target.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Agent   |
| Start a Project CTA hierarchy (AC6)                             | **No change — decision recorded.** The design already shows one primary action per region: the homepage carries two primary CTAs (hero and closing section) with the same destination, top and bottom of the page, and the Solutions and project pages each show one. They do not compete within a view, matching DESIGN.md. No second approved visual exists to move to, so no emphasis was invented.                                                                                                                                                                                                                                                                                                                                                        | Founder |
| Card/panel boundaries still use `--color-border` (1.42:1)       | **Out of scope (Batch 3).** `ProjectCard`, `SolutionCard`, `StatusBadge`, `ResearchCard` and `StartProjectCta` boundaries fail 1.4.11 the same way the chip did. ENG-103 scoped only the filter chips; whole-card work is an explicit Batch 3 non-goal here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Founder |
| Mobile-header re-composition; in-content conversion CTAs        | **Out of scope (Batch 3),** by the issue's non-goals.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Founder |
| Work chip selected state is now colour-only                     | **Change Request — founder decision.** Before ENG-103 the default border (`--color-border`, #D9D9D5) vs pressed (`--color-tertiary`, #0f5b5a) differed 5.57:1 in lightness; after the AC1 fix the default (`--color-secondary`, #525252) vs pressed measure **1.01:1** against each other, so the selected chip now differs only by hue. `aria-pressed` still exposes the state to assistive tech and both borders clear 1.4.11 vs the surface, so this is not a normative failure — but it is a regression in the _visual_ selected cue for greyscale/CVD/low-vision users, introduced by this PR (not pre-existing). A non-colour cue (weight, icon, or an underline) is a design change to a frozen component; needs founder approval before implementing. | Founder |
| Impeccable audit/critique (AC11)                                | **Could not run.** No Impeccable tooling exists in this repository; the `.impeccable/` directory lives only in `tcyber925-del/Ethiosci-AI-Assistant`. Needs the tool's location or an approved substitute.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Founder |

ENG-103's PR is the only verification evidence; it was not re-verified against the live origin.

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
