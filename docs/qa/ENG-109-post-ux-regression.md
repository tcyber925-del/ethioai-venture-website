# ENG-109 QA-01 — post-UX integrated regression and production smoke verification

**Verdict: PASS on the tested commit, with one HIGH-severity release finding.**

The tested product tree (`main` @ `f094b79`) passes every deterministic check and every
browser, accessibility, responsive and conversion check this environment can run. The
**deployed origin does not serve that tree** — it is a stale build that predates ENG-103 and
ENG-106. That is the finding that matters, and it is a release-process gap rather than a code
defect.

- Tested commit: `f094b79e983b3110f77651725e0e48e0db9f8936` (`main`, "ENG-111: add an
  OpenHands adapter for the feature factory pack (#38)")
- Date of test: 2026-10-31
- Environment: Linux (Debian 13 trixie container), Node 24, npm 11.21.0, Chromium 155.0.8059.79
  (headless, DevTools Protocol), no Playwright/Puppeteer/Lighthouse installed
- Deployed origin: `https://ethioai-venture-website.tcyber925.workers.dev` (observed HTTP 200)

## Method

`npm run verify` ran in an isolated git worktree at the tested commit, and the browser checks
ran against that worktree's own `dist/` over a local static server — so the deep checks describe
the **tested commit's build**, not whatever is currently deployed. A separate production pass
then ran the same checks against the deployed origin. Both are reported, side by side, because
they disagree.

Harnesses are plain Node 24 using the native `WebSocket` for the DevTools Protocol; no
dependency was added to the repository. Evidence artifacts are in `evidence/ENG-109/`.

## Requirement 1–4 — repository, build, CI

| Check                                  | Result                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm ci` (profile `setup_command`)     | exit 0                                                                                                                |
| `npm run verify` (profile `full_gate`) | **exit 0**                                                                                                            |
| Tests                                  | **455 pass, 0 fail** (`node --test`)                                                                                  |
| Built pages                            | **14**                                                                                                                |
| Sitemap URLs                           | 13                                                                                                                    |
| Warnings                               | none observed in the gate output                                                                                      |
| GitHub CI, tested commit               | **success** — [CI run 41197759670](https://github.com/tcyber925-del/ethioai-venture-website/actions/runs/41197759670) |
| Tested tree == `f094b79` product tree  | yes — `git diff --stat f094b79..HEAD -- src astro.config.mjs package.json package-lock.json public scripts` is empty  |

Every sub-gate passed: `format:check`, `lint`, `typecheck`, `test`, `astro sync`, `build`,
`check:dist` (268 internal references), `check:seo`, `check:work`, `check:fonts`,
`check:pending`, `check:a11y`. Raw output: `evidence/ENG-109/verify.log`.

## Requirement 5 — responsive and navigation

All **seven viewport widths × 14 routes = 98 combinations** were checked at the tested commit.

| Width                                 | Combinations | Horizontal overflow |
| ------------------------------------- | ------------ | ------------------- |
| 320, 375, 768, 1024, 1280, 1440, 1920 | 14 each      | **0 in all 98**     |

- Header/nav/footer reflow cleanly; the header is 152px tall at 320px (nav on its own row) and
  78px from 768px up.
- The "Start a Project" CTA **never wraps** at any width — measured with `Range.getClientRects()`,
  one line at every viewport (`scrollWidth ≤ clientWidth`). The taller 52px rect at 320–375px is
  button padding, not text wrapping.
- No nested interactive controls and no duplicate tab stops in any of the 98 combinations.
- Navigation destinations all resolve; the primary nav carries Solutions / Work / Research /
  About / Start a Project.

Work-card behaviour at the tested commit, confirmed with real CDP key and mouse events:

- exactly **1 link and 1 tab stop per card** (2 cards, 2 links);
- the `::after` overlay is present (`position:absolute; inset:0`), so the **whole card surface**
  activates the single link — a click on the card's lower padding navigated to `/work/ethiobio`;
- keyboard: Tab reaches the card link, `:focus-visible` gives a 2px solid tertiary ring, and
  **Enter navigates** to `/work/ethiobio`.

Evidence: `evidence/ENG-109/responsive-sweep.json`, `interaction-probes.json`,
`local-work-320.png`, `local-work-1280.png`.

## Requirement 6 — accessibility

| Check                                       | Result across 98 combinations                                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exactly one meaningful `<h1>` per route     | **pass** (1 on every route; the 404 correctly has none)                                                                                                         |
| Heading order (no skipped levels)           | **pass**                                                                                                                                                        |
| Landmark semantics (header/nav/main/footer) | **pass**                                                                                                                                                        |
| Current-page nav semantics                  | **pass** — `aria-current="page"` on the matching item in both the primary and footer nav (2 per route, by design)                                               |
| Accessible names on links/buttons           | **pass** — 0 nameless controls                                                                                                                                  |
| Focus visibility                            | **pass** — global `:focus-visible` gives `outline: 2px solid var(--color-tertiary)`; confirmed with real key events                                             |
| Reduced motion                              | **pass** — `prefers-reduced-motion: reduce` collapses transitions to 0.01ms                                                                                     |
| Keyboard-only journeys                      | **pass** — from the top of `/work/`, the in-content "Start a Project" CTA is reached in 8 tab stops; Skip-to-content is first                                   |
| Contrast — Work filter chips                | **pass at the tested commit** — default border `--color-secondary` (#525252, 7.81:1), pressed `--color-tertiary` (#0f5b5a, 7.88:1), plus a `font-weight` change |
| Contrast — form input borders               | **pass** — #525252 (7.81:1) on white                                                                                                                            |

### Observation, not a defect — the selected filter chip

The selected chip differs from the unselected chip by a **1.01:1** border/colour pair
(#525252 vs #0f5b5a) — a hue-only cue. It is **not** a WCAG 1.4.11 failure, because the selected
chip also carries a non-colour cue (`font-weight: var(--text-label-weight)` = 600), which is what
distinguishes it without relying on colour. This is the ENG-103 AC1 fix working as designed; it is
recorded here because the _deployed_ site does not have it (see the finding below).

### ENG-103 AC11 — cannot be satisfied on this evidence

AC11 requires the approved Impeccable audit. The tool CR-001 approved as the substitute
(`~/.agents/skills/impeccable`) is **not installed in this environment** and `/home/tcyber/` is
unreachable. **AC11 is therefore not satisfied and is not marked satisfied.** Minimum access to
run it: either install the skill in this environment, or grant read access to
`/home/tcyber/.agents/skills/impeccable`, or name a founder-approved alternative. This mirrors
`docs/STATUS.md`'s existing ENG-103 row, which already records the blocker as resolved but the
re-audit as an open founder call.

## Requirement 7 — Work / Research conversion

- `/work/`: in-content "Start a Project" CTA present in `main`, correctly linked to
  `/start-a-project`, reachable by keyboard in 8 tab stops.
- `/research/`: in-content CTA present in `main` and linked to `/start-a-project`. The page shows
  an explicit empty state ("No research has been published yet") and makes **no unsupported
  claim** — no pattern matching published research, papers or studies was found.
- The status filter works: toggling a chip moves `aria-pressed` correctly and updates the live
  region ("Showing 2 of 2 projects."). With only two projects, both currently "In Development",
  no chip combination hides a card, which is correct.

## Requirement 8–9 — production smoke against the deployed origin

| Route                                                                                                                                                  | Status                            | `<h1>` | og: tags | canonical | analytics      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ------ | -------- | --------- | -------------- |
| `/`, `/solutions/`, `/work/`, `/work/ethiobio/`, `/work/ethiosci/`, `/research/`, `/about/`, `/start-a-project/`, `/solutions/ai-applications-agents/` | 200                               | 1      | 5        | present   | script present |
| `/sitemap.xml`                                                                                                                                         | 200 (13 URLs)                     | —      | —        | —         | —              |
| `/robots.txt`                                                                                                                                          | 200, `Allow: /` + sitemap pointer | —      | —        | —         | —              |
| unknown path                                                                                                                                           | 404 (branded page)                | —      | —        | —         | —              |

- **Console errors: 0. Failed requests: 0. Broken internal links: 0** across all nine routes.
- Analytics hooks observed on the project detail page (`github-click`, `demo-click`) — read from
  the DOM, **no events fabricated and none sent**.
- **The live production form was NOT submitted.** Its markup, endpoint (`https://formspree.io/f/xrpeggll`),
  method, 6 fields (3 required, all labelled) and 2 honeypots (`_honey`, `_gotcha`) were verified
  statically. A live end-to-end submission is **not verified** and must not be triggered without
  founder approval.
- Performance (3 cold runs, cache disabled, CDP navigation timing, median): TTFB 60ms,
  FCP 108ms, DOMContentLoaded 94ms, load 96ms, 4 resources, ~14KB transferred. Tool, conditions
  and raw runs are in `evidence/ENG-109/performance.json`. No improvement is claimed — there is no
  comparable baseline.

## FINDING 1 — HIGH: the deployed origin serves a stale build

**The deployed site does not contain ENG-103 or ENG-106.** It predates both UX batches.

Evidence, all gathered 2026-10-31:

| Signal                                 | Deployed origin                                   | Tested commit build                  |
| -------------------------------------- | ------------------------------------------------- | ------------------------------------ |
| CSS bundle hash                        | `BaseLayout.C6TDEktS.css`                         | `BaseLayout.B2aqkuIU.css`            |
| Local build's CSS at the deployed hash | `404` (not deployed)                              | —                                    |
| Filter chip default border             | `--color-border` #D9D9D5 → **1.42:1**             | `--color-secondary` #525252 → 7.81:1 |
| Selected chip non-colour cue           | none                                              | `font-weight: 600`                   |
| Inter font preload                     | absent                                            | present                              |
| Card full-surface hit target           | **absent** — clicking card body does not navigate | present — click navigates            |

The card behaviour is the clearest functional proof: on the tested build a click on the card's
lower padding navigates to `/work/ethiobio`; on the deployed origin the same click does nothing
(`location.pathname` stays `/work/`), because the `::after` overlay rule is missing.

Two consequences worth stating plainly:

1. **The deployed filter chips fail WCAG 1.4.11** (non-text contrast). The deployed chip border is
   `--color-border` at 1.42:1 against white, below the 3:1 floor, and the deployed selected chip
   has no non-colour cue at all. This is exactly what ENG-103 fixed — and the fix is not deployed.
2. **The ENG-106 usability work is not live.** The whole-card hit target users were promised is
   not on the deployed site.

Root cause: there is **no deploy workflow** in `.github/workflows/` (only `ci.yml` and
`opencode-review.yml`), and `wrangler.jsonc` points at `./dist`. Deployment is manual and one is
overdue. CI green is not the same as deployed.

Severity HIGH because it is a live-site correctness and accessibility gap against merged,
approved work — not a code defect in `main`.

## FINDING 2 — MEDIUM: ENG-103 AC11 is not re-audited

The approved Impeccable tool is absent from this environment, so AC11 remains open. Recorded as a
limitation with the access needed, per Requirement 7. Not a product defect.

## Non-findings (checked, clean)

Zero horizontal overflow at any width; CTA never wraps; no nested interactive controls; no
nameless controls; exactly one `<h1>` per route; heading order valid; `aria-current` correct;
reduced-motion honoured; keyboard journeys work; analytics hooks present; no unsupported research
claims; form correctly wired and deliberately not submitted.

## Acceptance criteria status

| AC                                                                 | Status                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------- |
| 1 — commit SHA, tool versions, viewport results, commands recorded | met                                                       |
| 2 — `npm run verify` passes, or every failure classified           | met (exit 0, 455 tests, 14 pages)                         |
| 3 — seven viewports across affected routes, with evidence          | met (98 combinations, 0 overflow)                         |
| 4 — keyboard/a11y checks with findings and severity                | met                                                       |
| 5 — fresh Impeccable output + ENG-103 AC11 disposition             | **not met** — tool absent; limitation recorded, AC11 open |
| 6 — deployed smoke: pages, nav, metadata/SEO, errors, analytics    | met                                                       |
| 7 — production form not triggered; status stated                   | met (not submitted; status stated)                        |
| 8 — no implementation changes under this QA issue                  | met (diff touches `docs/` only)                           |
| 9 — concise pass/fail report with severity-ranked findings         | met (this document)                                       |

## Recommendation

1. **Re-deploy `main` to the Cloudflare Worker.** This is the single highest-value action: it
   ships ENG-103's accessibility fix and ENG-106's card usability, both already merged and
   reviewed. Verify afterwards by re-running this smoke pass and confirming the CSS hash matches
   the current build.
2. **Add a deploy workflow** (or a documented manual runbook) so "merged" and "deployed" cannot
   drift again. This is an infrastructure change and needs approval — not done here.
3. **Grant Impeccable access** to close ENG-103 AC11, or record the founder's decision to leave it
   open.
4. **No further implementation batch is justified** by this evidence: the tested commit is clean.
   The gap is release, not code.

## Out of scope / not done

No product change; no token, copy, claim, route, analytics or form change; no fix applied for
Finding 1 (it is a finding, not a fix); no live form submission; no deploy; no Impeccable audit
(tool absent).
