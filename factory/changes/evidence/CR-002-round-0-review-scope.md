VERDICT: CHANGES

Scope: docs-only change on `factory/001-post-ux-qa-regression` (`f094b79..b9338dc`, head
`b9338dc7a3ae90e948fcd8a4b4e8d0e8a24b2453`). Reviewed the committed report
`docs/qa/ENG-109-post-ux-regression.md` and every committed artifact under
`docs/qa/evidence/ENG-109/` (`responsive-sweep.json`, `interaction-probes.json`,
`production-smoke.json`, `performance.json`, `deployed-vs-local-diff.json`,
`deployed-origin-work.html.txt`, `deployed-origin-baselayout.css.txt`, `verify.log`; the three
PNGs by presence/size only), against `spec.md`, `job.json` and `evidence.json`. Independently
re-checked: `git diff --name-only f094b79..HEAD` and `main...HEAD` (docs/ only), the product-tree
diff (empty), the frozen pack `.opencode/skills/factory/`+`.factory/`+`factory/` (untouched),
`git merge-base --is-ancestor f094b79 HEAD` (exit 0), `npx prettier --check` on the report
(clean), and the live origin `curl` (HTTP 200).

Two of the explicitly requested checks are clean and I want them recorded plainly, because the
verdict below is not about them:

- **AC5 / ENG-103 AC11 honesty — PASS.** The report does not claim a pass it did not achieve.
  It states at line 101 "**AC11 is therefore not satisfied and is not marked satisfied.**",
  marks AC5 "**not met**" in the AC table (line 193), records Finding 2 (line 173), and names the
  minimum access needed (lines 102-103). No text anywhere claims AC11 passed or is satisfied
  (grep for `satisfied` returns only the negative statements). This is honest and correct.
- **Scope drift — none.** The diff is `docs/`-only (12 files, all under `docs/qa/`); the product
  tree diff (`src`, `astro.config.mjs`, `package.json`, `package-lock.json`, `public`, `scripts`,
  `tests`, `wrangler.jsonc`) is empty; the frozen factory pack is untouched; no token, copy,
  route, analytics or form change; all new files mode `100644`. AC12/AC13 are met.

The findings below are where the report's *evidence traceability* breaks: it states things that
its own cited artifacts contradict, or omits the artifact pointer an AC explicitly requires.

## Findings

### blocking — docs/qa/ENG-109-post-ux-regression.md:38
The gate table row `Warnings | none observed in the gate output` is false against the artifact it
cites for the whole exit-0 claim. `docs/qa/evidence/ENG-109/verify.log` contains 12 `[WARN]` lines
— `[glob-loader] No files found matching "**/*.md" in directory "src/content/research"`
(lines 20, 594, 602) and `[content] The collection "research" does not exist or is empty`
(lines 616, 619, 622, 624, 626, 628, 630, 632, 639) — plus the typecheck warning
`tests/check-pending.test.mjs:633:14 - warning ts(6133): 'm' is declared but its value is never
read` (line 24) and `- 1 hint` (line 32). Requirement 3 / AC2 require the report to record
*every* warning. Why it matters: this is a materially false statement about the very artifact
that backs the report's central "exit 0" claim, and it drops exactly the warnings the requirement
asks to capture (an empty content collection is a real build signal, not noise). Remediation:
enumerate the observed warnings, or state their counts and classify the empty-`research` warnings
as expected pre-existing state — rather than "none observed".

### blocking — docs/qa/ENG-109-post-ux-regression.md:56
The report claims the "Start a Project" CTA "**never wraps** at any width — measured with
`Range.getClientRects()`, one line at every viewport (`scrollWidth ≤ clientWidth`)", citing
`evidence/ENG-109/responsive-sweep.json` (line 71). That artifact does not support the claim:
`"lines": 2` appears 91 times in `responsive-sweep.json` (first at line 50, route `/` @320, the
132x52 in-content CTA), and it is present at *all seven* viewports (320 through 1920) for every
route — not only at 320-375px as the report's parenthetical asserts. The `Range.getClientRects()`
measurement the prose describes was produced by an uncommitted harness (not in the diff); no
committed artifact contains `scrollWidth`/`clientWidth` or a range-rect line count. Why it
matters: Requirement 5 requires the CTA-wrapping result to be recorded, and a reader who opens the
cited file sees `lines: 2` at 1920 and cannot reconcile it with "one line at every viewport" —
the report's headline responsive non-finding is asserted against the file that shows the opposite
number. Remediation: commit the `Range.getClientRects()` output (or add a `linesRangeRects` field
to `responsive-sweep.json`) and cite it, and either drop or explicitly qualify the sweep's
padding-inflated `lines` metric so the prose and the artifact agree.

### blocking — docs/qa/ENG-109-post-ux-regression.md:118
The Requirement 8-9 production-smoke section (lines 118-137) never names
`evidence/ENG-109/production-smoke.json` — that file has 0 mentions anywhere in the report (grep
`production-smoke|deployed-vs-local|deployed-origin|deployed-work` → 0 matches), even though it is
the artifact holding the nine-route statuses, per-page metadata (`title`/`desc`/`ogCount`),
canonicals, `consoleErrors`/`failed` arrays, `broken` links, sitemap and robots data the section
summarizes. Only `performance.json` is cited there. AC10 requires each smoke check to be "pointed
at an evidence artifact"; AC14 requires "links to each evidence artifact". Neither holds for
`production-smoke.json`, and the same gap covers `deployed-vs-local-diff.json`,
`deployed-origin-work.html.txt`, `deployed-origin-baselayout.css.txt` and `deployed-work-1280.png`,
none of which the report references (the Finding 1 comparison table at lines 145-152 cites no
artifact at all). Why it matters: the deployed-smoke claims (0 console errors, 0 broken links, 13
sitemap URLs, robots contents, 404) are not traceable to their source from the report, which is
the report's whole reason to exist. Remediation: add explicit `evidence/ENG-109/production-smoke.json`
pointers for the route/metadata/SEO/error claims, and cite the deployed-origin artifacts under
Finding 1.

### non-blocking — docs/qa/ENG-109-post-ux-regression.md:78
The a11y row reads `pass (1 on every route; the 404 correctly has none)`. This is internally
inconsistent and contradicted by the cited artifact: `responsive-sweep.json` reports `/404.html`
with `h1Count: 1` and `h1: ["Page not found"]` at all seven viewports (e.g. line 12346). The
substance of AC7 (report names "one meaningful `<h1>` per route" and gives the correct result) is
met, so this does not fail an AC — but the justification is wrong. Remediation: state that the 404
carries one `h1` ("Page not found") like every other route.

### non-blocking — docs/qa/ENG-109-post-ux-regression.md:81
`aria-current="page" … (2 per route, by design)` overstates: `responsive-sweep.json` shows 0
`ariaCurrent` entries on `/` and `/404.html` (no matching nav item) and 2 on the other 12 routes.
AC7 is still met. Remediation: say "2 on routes with a matching nav item, 0 on `/` and `/404`".

### non-blocking — docs/qa/ENG-109-post-ux-regression.md:59
"No nested interactive controls and no duplicate tab stops in any of the 98 combinations" — the
sweep measures a `focusables` count and `nested` only; it does not detect duplicate tab stops. The
"1 link / 1 tab stop per card" evidence (`interaction-probes.json`) covers `/work/` only.
Requirement 5's card claims are supported there; the 98-combination wording is not. Remediation:
scope the claim to what the sweep measures, or add a tab-order probe.

### non-blocking — docs/qa/ENG-109-post-ux-regression.md:83 and :152
Two evidence mismatches worth correcting alongside the above. (1) The focus-visibility claim
("confirmed with real key events") is not backed by the committed `interaction-probes.json`, whose
`focusVisible` object records `outlineStyle: "none"`, width `3px`, colour `rgb(23,23,23)` — the
2px tertiary outline is real in the CSS but the committed probe did not trigger `:focus-visible`.
(2) `deployed-vs-local-diff.json:15` records `"cardOverlay": false` for the **local** build,
contradicting the report's Finding 1 (line 152) and the sibling `interaction-probes.json`
(`workCard.overlay` = `position:absolute; inset:0px`); the local build does contain the overlay
rule (`dist/work/index.html`: `a:after{content:"";position:absolute;inset:0}`), so the artifact's
local value is wrong. The report's Finding 1 claim is separately supported, so this is an artifact
bug rather than a false report claim — but it is a committed artifact that contradicts itself.
Remediation: fix the harness that computes `cardOverlay` and regenerate, or drop the field.

### non-blocking — docs/qa/ENG-109-post-ux-regression.md:20
Requirement 3 / AC3 ask the report to record `npm run verify`'s working directory. The Method
section describes "an isolated git worktree at the tested commit" but never states the exact path
(`/workspace/project/ethioai-venture-website-factory/001-post-ux-qa-regression`). The command,
exit status, test count and page count are all present. Remediation: name the working directory
literally.

## Not inspected
- The GitHub CI conclusion and run URL (report line 39) — no network access to GitHub from this
  environment; the claim is recorded, not re-queried.
- The three PNGs (`local-work-320.png`, `local-work-1280.png`, `deployed-work-1280.png`) — visual
  fidelity/visual diff is the visual lens's scope; I checked presence and size only.
- The non-committed Node/CDP harness sources (they live outside the repo, e.g. `/tmp/eng109/`) —
  not part of the reviewed diff, so there is nothing committed to inspect; this is why the
  `Range.getClientRects()` and "real key events" claims cannot be reproduced from the change.
- I did not re-run `npm run verify` (the 455 tests / 14 pages / exit 0 were read from `verify.log`,
  which matches the report) nor re-run the CDP harnesses.
