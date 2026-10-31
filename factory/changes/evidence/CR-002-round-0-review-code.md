VERDICT: CHANGES

Scope: docs-only change on `factory/001-post-ux-qa-regression` (`f094b79..b9338dc`). Reviewed
`docs/qa/ENG-109-post-ux-regression.md` and all committed evidence under
`docs/qa/evidence/ENG-109/` (`responsive-sweep.json`, `interaction-probes.json`,
`production-smoke.json`, `performance.json`, `deployed-vs-local-diff.json`,
`deployed-origin-work.html.txt`, `deployed-origin-baselayout.css.txt`, `verify.log`; PNGs
listed but not visually diffed). Cross-checked numbers programmatically against the raw JSON,
and cross-checked the local `dist/` build the evidence claims to describe. Confirmed the diff is
docs-only: `git diff --name-only f094b79...HEAD` lists only `docs/qa/**`.

## Findings

### blocking — docs/qa/ENG-109-post-ux-regression.md:56
The report claims the "Start a Project" CTA **never wraps** at any width, "measured with
`Range.getClientRects()`, one line at every viewport (`scrollWidth ≤ clientWidth`)", and cites
`evidence/ENG-109/responsive-sweep.json` (line 71) as evidence. That artifact does not support
the claim: every `layout.ctaRects` entry for the 132x52 CTA carries `"lines": 2` — 91 of the 294
measured rects, present at *all seven* viewports including 1920 (`responsive-sweep.json`,
route `/` @320 and @1920, route `/work/` @1920). The `Range.getClientRects()` measurement the
prose describes was produced by an uncommitted harness (`/tmp/eng109/ctawrap.mjs`); no committed
artifact contains it. So the report's headline non-finding is asserted against the very file that
shows the opposite number. Why it matters: a verification report's value is that each claim is
readable from its evidence; here a reader who opens the cited file sees `lines: 2` and cannot
reconcile it. Remediation: commit the `Range.getClientRects()` output (or add a
`linesRangeRects` field to `responsive-sweep.json`) and cite that artifact, and either drop or
explicitly qualify the sweep's padding-inflated `lines` metric so the two agree.

### blocking — docs/qa/ENG-109-post-ux-regression.md:38
The gate table states `Warnings | none observed in the gate output`. `verify.log` shows otherwise:
12 `[WARN]` lines — `[glob-loader] No files found matching "**/*.md" in directory
"src/content/research"` (lines 20, 594, 602) and `[content] The collection "research" does not
exist or is empty` (lines 616, 619, 622, 624, 626, 628, 630, 632, 639) — plus a typecheck warning
`tests/check-pending.test.mjs:633:14 - warning ts(6133): 'm' is declared but its value is never
read` (line 24). Requirement 3/AC2 requires the report to record *every* warning. Why it matters:
this is a materially false statement about the artifact the report points at for its central
"exit 0" claim, and it drops exactly the warnings the requirement asks to capture (an empty
content collection is a real build signal, not noise). Remediation: enumerate the observed
warnings (or state the counts and classify the empty-`research` warnings as expected pre-existing
state), rather than "none observed".

### blocking — docs/qa/evidence/ENG-109/deployed-vs-local-diff.json:15
This committed evidence file records `"cardOverlay": false` for the **local** build, directly
contradicting the report's Finding 1 (`docs/qa/ENG-109-post-ux-regression.md:152`,
"Card full-surface hit target … present — click navigates") and its own sibling artifact
`interaction-probes.json` (`workCard.overlay`: `{"position":"absolute","inset":"0px"}`). The
local value is simply wrong: the local build's HTML contains the overlay rule
(`.project-card__title … a:after{content:"";position:absolute;inset:0}`, verified in the worktree
`dist/work/index.html`), whereas the deployed HTML does not (`a:after` count 0 in
`deployed-origin-work.html.txt`). Why it matters: this is the single artifact that purports to
diff deployed vs local on the exact property the headline finding rests on, and it reports the
local build as *lacking* the feature the report says it *has* — a reader auditing the evidence
sees a contradiction. Remediation: fix the harness that computes `cardOverlay` (it appears to test
the card root's `::after` rather than the title link's), regenerate
`deployed-vs-local-diff.json`, or drop the field and rely on `interaction-probes.json` /
`deployed-origin-work.html.txt`.

### blocking — docs/qa/ENG-109-post-ux-regression.md:78
The accessibility table says `Exactly one meaningful <h1> per route | pass (1 on every route; the
404 correctly has none)`. The cited evidence says the opposite: `responsive-sweep.json` reports
`/404.html` with `h1Count: 1` and `h1: ["Page not found"]` at all seven viewports. The
parenthetical is also internally inconsistent with "1 on every route". Why it matters: a false
statement contradicted by the report's own artifact in the section a reader is most likely to
trust; the pass verdict is unaffected but the justification is wrong. Remediation: state that the
404 carries one `h1` ("Page not found") like every other route.

### blocking — docs/qa/ENG-109-post-ux-regression.md:118
The Requirement 8-9 production-smoke section (lines 118-137) never names
`evidence/ENG-109/production-smoke.json` — that file has zero mentions anywhere in the report
(verified: 0 matches), even though it is the artifact holding the nine-route statuses, metadata,
canonicals, console-error/failed-request arrays, sitemap and robots data the section summarizes.
Only `performance.json` is cited in this section. AC10 requires each production-smoke check to be
"pointed at an evidence artifact". Why it matters: the deployed-smoke claims (0 console errors, 0
broken links, 13 sitemap URLs, robots contents) are not traceable to their source from the
report. Remediation: add explicit `evidence/ENG-109/production-smoke.json` pointers for the
route/metadata/SEO/errors claims (and cite `deployed-origin-work.html.txt` /
`deployed-origin-baselayout.css.txt` / `deployed-work-1280.png` for Finding 1, none of which are
currently referenced).

## Not inspected
- The three PNGs (`local-work-320.png`, `local-work-1280.png`, `deployed-work-1280.png`) were not
  visually diffed; only their presence/size was checked.
- The GitHub CI conclusion (report line 39) is a network-gated claim; I did not re-query
  `gh run view`. I did re-check the deployed origin live (`curl` → HTTP 200), consistent with the
  report.
- I did not re-run `npm run verify` (455 tests / 14 pages were read from `verify.log`, which
  matches the report) or re-run the CDP harnesses; harness sources live outside the repo in
  `/tmp/eng109/` and are not part of the reviewed change.
- Prettier-cleanliness of the report and the `main...HEAD` docs-only scope were not re-run beyond
  the `git diff --name-only` check.

## Notes
Non-blocking, but worth correcting alongside the above:
- Report line 81 ("`aria-current="page"` … 2 per route, by design") overstates: the sweep shows 0
  `aria-current` entries on `/` and `/404.html` (no matching nav item), 2 on the other 12 routes.
- Report line 59 claims "no duplicate tab stops in any of the 98 combinations", but
  `responsive-sweep.json` measures only a `focusables` count and `nested`; it does not detect
  duplicate tab stops. The card-level "1 link / 1 tab stop" evidence
  (`interaction-probes.json`) covers only `/work/`.
- Report line 83 (focus visibility) is contradicted by the committed `interaction-probes.json`
  `focusVisible` object (`outlineStyle: "none"`, width `3px`, color `rgb(23,23,23)`); the 2px
  tertiary outline is real in the CSS (`deployed-origin-baselayout.css.txt`) but the probe's
  programmatic `.focus()` did not trigger `:focus-visible`, and the "real key events" run is not
  committed.
- The report cites evidence as `evidence/ENG-109/...` (relative to the report's own `docs/qa/`
  directory), whereas the spec (AC7) assumed repository-relative `docs/qa/evidence/ENG-109/...`.
  Both are resolvable from the report's location, but the convention differs from the spec.
