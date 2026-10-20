# Project status

**Last updated:** 2026-10-20 (Linear **ENG-108**; Git state and branch cleanup refreshed)
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

Linear project **P-ENG-6** has 28 issues, all Done. The phase table above names **23** of
them — the G0 to G4 phase gates. The remaining **5** sit outside that scope: ENG-101 (docs
refresh), ENG-102 (UX batch 1), ENG-103 (UX batch 2), ENG-106 (UX batch 3A) and ENG-107
(UX batch 3B). 23 + 5 = 28. ENG-96 is **not** a member of this project.

Follow-ups raised during the release wave but tracked outside the project — ENG-95
(work-page regression gate) and ENG-100 (EthioSci entry and demo/GitHub event
verification) — are also Done.

## Git state

- **`main`** — `ffd0330`, "Docs: document Python dependency for the font pipeline in README
  prerequisites (#29)", as of the ENG-108 branch. Merging ENG-108 (PR #36) moves `main` on by one
  squash commit; read the current tip with `git log -1 --oneline main` rather than from this line.
- **36 pull requests** — 33 merged, 3 closed (#28, #33, #35), 0 open, counted as of the merge of
  ENG-108 (PR #36). The three closed PRs are superseded duplicates, not abandoned work: #28 by #32,
  #33 by #34, #35 by #30. Merges are **squashed from #13 onward**, so those feature branches are
  not ancestors of `main`; each merged PR's identity is preserved in a commit subject line on
  `main`. The earliest 12 PRs (#1–#12) landed as merge commits instead, so their branches **are**
  ancestors of `main`.
- **No stale feature branches remain on the remote** — the only branches on `origin` are `main` and
  the open ENG-108 branch, which is deleted once its PR merges. The earlier 12-branch cleanup is
  complete. The three factory job branches (ENG-106, ENG-107, the README prerequisites job) were
  deleted by GitHub automatically as each PR merged, on 2026-10-17 and 2026-10-18. The 2026-10-20
  cleanup removed the two branches whose PRs were closed without merging (#28's and #35's heads),
  whose work had already landed by another route.
- **Local worktrees** — one, the primary checkout. The three factory job worktrees under
  `../ethioai-venture-website-factory/` were removed after their jobs were merged.

## Verification

The table below is the **ENG-101 snapshot, measured on `main` at `fd46407` (2026-10-05)** and
committed by PR #25 on 2026-10-09. It is kept as the historical record of that release.
For the current tree, measure it yourself:

```sh
npm run verify
```

As of 2026-10-20 (ENG-108): **455 tests / 46 suites, 0 failures**, and **14 pages** built —
after ENG-102 added `check:fonts`/`check:pending`, ENG-103 added `check:a11y`, and ENG-106
and ENG-107 extended that gate with the work-card and in-content-CTA contracts.
`check:dist` now reports 268 internal references (251 in the snapshot below).

| Check                                 | Result (ENG-101 snapshot, `main` at `fd46407`)                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `format:check` / `lint` / `typecheck` | pass                                                                                |
| `npm test`                            | **314 tests, 28 suites, 0 failures**                                                |
| `astro sync`                          | pass (collection schemas valid)                                                     |
| `npm run build`                       | **14 pages**                                                                        |
| `npm run check:dist`                  | 14 pages, 251 internal references, 0 problems, analytics enabled (`ethioaiventure`) |
| `npm run check:seo`                   | 14 pages, 13 sitemap URLs, 0 problems                                               |
| `npm run check:work`                  | 2 hide rules across 15 CSS sources, 3 routes present                                |

Thirteen test files carry the regression contracts: `analytics`, `analytics-client`,
`check-a11y`, `check-dist`, `check-pending`, `check-seo`, `check-work`, `content-predicate`,
`content-slugs`, `fonts`, `route-patterns`, `site-assets` and `start-a-project`.

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

| Item                                                     | State                                                                                                                                                                                                                                                                                             | Owner                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Research content                                         | Closed as won't-do by decision (2026-10-05). The collection stays empty rather than inventing entries.                                                                                                                                                                                            | Founder                 |
| Custom domain                                            | Closed by decision (2026-10-05): not purchasing one. Attaching later is a one-line change to `site.url` plus one re-verification pass.                                                                                                                                                            | Founder                 |
| ENG-96 — Work status taxonomy and project image metadata | Backlog, and **not a member of P-ENG-6**. Change request from ENG-80's advisory review; V1 shipped with `status` as a validated free-text string and filter chips derived at render time.                                                                                                         | Founder                 |
| Delete merged remote branches (was 12)                   | Done. The three factory job branches were deleted by GitHub as their PRs merged (2026-10-17, 2026-10-18); the 2026-10-20 cleanup removed the two heads of closed PRs #28 and #35. The only branches left on `origin` are `main` and the open ENG-108 branch, which is deleted once its PR merges. | Anyone with push access |
| `og:image`                                               | Not built: no approved brand image exists.                                                                                                                                                                                                                                                        | Founder                 |

### ENG-103 — Batch 2 accessibility and navigation polish

Recorded 2026-10-13. Of the seven items below: **three were fixed in code**, **one is a recorded
no-change decision**, **two are out of scope for Batch 3**, and **one (AC11) did not run at the
time**. The Impeccable blocker behind that last item was resolved on 2026-10-16 when the founder
approved the globally-installed skill as the substitute; see that row for the current position.
The three fixed items are the chip boundary, the nav semantics/target size, and the chip's
selected cue (escalated as a Change Request, then approved by the founder); the rest are
reported, not fixed, because the issue's explicit non-goals reserve whole-card work for Batch 3.

| Item                                                            | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Owner   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Work filter chip boundary (WCAG 1.4.11)                         | **Fixed.** The chip's default border moved from `--color-border` (1.42:1) to `--color-secondary` (7.81:1 on surface, 7.48:1 on the page neutral). No token changed; an approved colour was reused.                                                                                                                                                                                                                                                                                                                                                                                                                                     | Agent   |
| Nav list semantics, `aria-current="page"`, nav-link target size | **Fixed.** `role="list"` restored on the marker-stripped lists; the current page is marked on header/footer nav; nav links carry block padding for a ≥24×24 target.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Agent   |
| Start a Project CTA hierarchy (AC6)                             | **No change — decision recorded.** The design already shows one primary action per region: the homepage carries two primary CTAs (hero and closing section) with the same destination, top and bottom of the page, and the Solutions and project pages each show one. They do not compete within a view, matching DESIGN.md. No second approved visual exists to move to, so no emphasis was invented.                                                                                                                                                                                                                                 | Founder |
| Card/panel boundaries still use `--color-border` (1.42:1)       | **Out of scope (Batch 3).** `ProjectCard`, `SolutionCard`, `StatusBadge`, `ResearchCard` and `StartProjectCta` boundaries fail 1.4.11 the same way the chip did. ENG-103 scoped only the filter chips; whole-card work is an explicit Batch 3 non-goal here.                                                                                                                                                                                                                                                                                                                                                                           | Founder |
| Mobile-header re-composition; in-content conversion CTAs        | **Out of scope (Batch 3),** by the issue's non-goals.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Founder |
| Work chip selected state colour-only after AC1                  | **Fixed (founder approved).** Before ENG-103 the default border (`--color-border`, #D9D9D5) vs pressed (`--color-tertiary`, #0f5b5a) differed 5.57:1 in lightness; after the AC1 fix the default (`--color-secondary`, #525252) vs pressed measure **1.01:1**, so the selected chip differed only by hue. The pressed chip now also carries `font-weight: var(--text-label-weight)` (600) — a non-colour cue that survives greyscale, CVD and low vision. `check:a11y` asserts a weight/thickness/shadow cue on the pressed rule, so it cannot regress to colour-only.                                                                 | Agent   |
| Impeccable audit/critique (AC11)                                | **Tool blocker resolved 2026-10-16; ENG-103 itself not retro-audited.** The skill is installed globally at `~/.agents/skills/impeccable`, not repo-local — the earlier `.impeccable/` note was correct but looked in the wrong place. The founder approved that tool as the substitute (Change Request CR-001). Audits have since run under that approval for ENG-106 (PR #31) and ENG-107 (PR #32): **zero findings** on each job's changed components, with out-of-scope findings documented rather than implemented. This row still reads as not-run because ENG-103's own AC11 was never re-audited; doing that is a founder call. | Founder |

ENG-103's PR is the only verification evidence; it was not re-verified against the live origin.

## Change Request CR-001 — the Impeccable tool substitution

CR-001 is the escalation that blocked **ENG-106** (Batch 3A, mobile navigation and work-card
usability) and **ENG-107** (Batch 3B, Work/Research conversion and reading clarity) until the
founder approved the globally-installed Impeccable skill as the substitute for the audit their
acceptance criteria required. Both jobs then approved and merged (PR #31, PR #32).

- The Change Request is recorded in `factory/changes/CR-001.md`.
- The Founder Decision that resolved it is recorded in `factory/changes/CR-001.decision.md`.

Both are tracked in the repository, so the decision that unblocked those two PRs is readable
without access to the factory job folders (which are gitignored scratch). The decision file
records when and what was decided; attributing **who** decided it is a founder action, still open
— see the "Related, not blocking" section of the Change Request.

The audit outputs and the two jobs' `evidence.json` are copied into `factory/changes/evidence/`
and tracked, so the "zero findings" claim above is checkable rather than asserted: the detector
found 0 issues on each job's changed components, and the 3 anti-patterns plus 2 advisory notes
elsewhere in `src` name only files neither job touched.

The ENG-103 row above records the same tool blocker for ENG-103's own AC11, which was never
re-audited and remains a founder call.

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
