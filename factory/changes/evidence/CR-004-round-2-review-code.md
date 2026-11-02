VERDICT: CHANGES

Scope: docs-only change on `factory/001-post-ux-qa-regression` (`f094b79..6d28cfb`, tip `6d28cfb`).
Reviewed `docs/qa/ENG-109-post-ux-regression.md` and every committed artifact under
`docs/qa/evidence/ENG-109/` (`verify.log`, `responsive-sweep.json`, `interaction-probes.json`,
`focus-visibility-probe.json`, `production-smoke.json`, `performance.json`,
`deployed-vs-local-diff.json`, `deployed-origin-work.html.txt`, `deployed-origin-baselayout.css.txt`;
the three PNGs by presence/name only). Re-derived every numeric claim from the raw JSON, re-checked
scope and ancestry, and re-ran an independent clean-load CDP tab-order probe. Confirmed docs-only
(`git diff --name-only f094b79..HEAD` all under `docs/qa/`), `f094b79` an ancestor of HEAD, and the
report Prettier-clean (`npx prettier --check` → "All matched files use Prettier code style!").

The three round-1 blocking findings are genuinely fixed at `6d28cfb`:
- **CTA box scoping (report:74-77)** — now reads "…occurs at **all seven viewports** (91 of 294
  rects), not only the narrow ones", matching `responsive-sweep.json` (boxH 52 = 91 rects, 13 per
  viewport, all 7 viewports; `textLines: 1` on 294/294).
- **Focus ring (report:88-95, :109)** — the newly committed `focus-visibility-probe.json` records
  `viaRealKeyEvents` = `solid 2px rgb(15, 91, 90)` on the EthioBio card link (and `viaFocusMethod`
  = `outlineStyle: "none"`), and the report cites it. The claim is now readable from its artifact.
- **Unreferenced artifacts (report:189-193, :254)** — `deployed-vs-local-diff.json` (2 refs) and
  `deployed-work-1280.png` (2 refs) are now cited; all 12 committed artifacts have ≥2 references.

All other numeric/factual claims reconcile with their cited artifacts: 455 tests / 14 pages /
13 sitemap URLs / 268 internal references / 12 `[WARN]` + 1 `ts(6133)` (verify.log); 98 combinations,
0 overflow; 294 CTA rects all `textLines: 1`; `h1Count` 1 on all 98 (incl. `/404.html`); `aria-current`
2 on the 12 nav routes and 0 on `/` and `/404.html`; production-smoke (9 pages, 200, h1 1, og 5,
canonical present, analytics script present; sitemap 13 URLs; robots `Allow: /` + sitemap; 404 branded);
form endpoint/method/6 fields/3 required/2 honeypots; performance medians. One claim does not.

## Findings

### blocking — docs/qa/ENG-109-post-ux-regression.md:111 (also :136)
The report states the `/work/` in-content "Start a Project" CTA "is reached in 8 tab stops" from the
top of the page — once in the Requirement 6 keyboard row (report:111) and again in Requirement 7
(report:136, "reachable by keyboard in 8 tab stops"). That figure is contradicted by the report's own
evidence and by an independent reproduction:

1. **Internal contradiction.** Report:88 and the newly committed
   `docs/qa/evidence/ENG-109/focus-visibility-probe.json` (`tabStopsFromTopToCardLink: 10`) place the
   *card link* at **10 tab stops** from the top of `/work/`. The in-content CTA is emitted *after* the
   cards (`src/pages/work/index.astro:43` `StatusFilter`, `:45-54` `ProjectCard` list, `:68`
   `StartProjectCta`), so it cannot be reached earlier than the card links — 8 < 10 is impossible.
2. **The cited artifact does not support it.** `interaction-probes.json` `keyboardWork.seq` holds 8
   entries (`body`, `Skip to content`, `EthioAI Venture`, `Solutions`, `Work`, `Research`, `About`,
   `a:Start a Project`) and contains **no filter chips and no card links** — so it is not a `/work/`
   sequence at all; its final entry is the *nav* CTA. The value 8 matches `/research/`, whose tab
   order is Skip → wordmark → Solutions → Work → Research → About → nav CTA → in-content CTA.
3. **Independent reproduction.** A clean-load CDP probe (Chromium 155.0.8059.79, 1280×900, no
   programmatic `el.focus()`) reaches the in-content `a.btn--primary` on `/work/` at tab stop **12**:
   1 Skip, 2 wordmark, 3 Solutions, 4 Work, 5 Research, 6 About, 7 nav "Start a Project",
   8 "All statuses" chip, 9 "In Development" chip, 10 EthioBio, 11 EthioSci, 12 in-content CTA. The
   same probe reaches it at **8** on `/research/`.

Why it matters: this is the same claim-not-readable-from-evidence pattern the two prior rounds blocked
on, in the section the round-1 fixes were meant to close; the number is attributed to the wrong route
and directly contradicts the report's own line 88. The Requirement 6/7 "reachable by keyboard"
*conclusion* remains true (12 stops), so the pass verdict is unaffected — but the stated figure is
false and traceable to an artifact that is itself mislabeled (`keyboardWork.steps: 8`).

Remediation: state the `/work/` figure (12 tab stops) at report:111 and report:136; or, if the intended
measurement was `/research/`, say `/research/` and cite the research tab order/`researchCta`. Either
way, reconcile the two instances with report:88 / `focus-visibility-probe.json`
(`tabStopsFromTopToCardLink: 10`), and relabel or drop the `keyboardWork` block in
`interaction-probes.json`, whose `seq` is not a `/work/` sequence.

## Not inspected
- The three PNGs (`local-work-320.png`, `local-work-1280.png`, `deployed-work-1280.png`) for rendered
  content — visual fidelity is the visual lens's scope; presence/name only.
- The GitHub CI run URL (report:40) — no network access to GitHub from this environment; recorded, not
  re-queried.
- The non-committed Node/CDP harness sources (they live outside the repo) — not part of the reviewed
  diff, which is the root cause of the unbacked `keyboardWork.steps` figure.
- I did not re-run `npm run verify`; the 455 tests / 14 pages / exit 0 / 12 `[WARN]` were read from
  `verify.log` and match the report.
