VERDICT: CHANGES

Scope: docs-only change on `factory/001-post-ux-qa-regression` (`f094b79..6d28cfb`, tip `6d28cfb`).
Reviewed the committed report `docs/qa/ENG-109-post-ux-regression.md` and every committed artifact
under `docs/qa/evidence/ENG-109/` (`verify.log`, `responsive-sweep.json`, `interaction-probes.json`,
`focus-visibility-probe.json`, `production-smoke.json`, `performance.json`,
`deployed-vs-local-diff.json`, `deployed-origin-work.html.txt`, `deployed-origin-baselayout.css.txt`;
the three PNGs by presence/name/reference only), against the 14 acceptance criteria in `spec.md`.
Independently re-checked: `git diff --name-only main...HEAD` (docs-only), `git merge-base --is-ancestor
f094b79e983b3110f77651725e0e48e0db9f8936 HEAD` (exit 0), tracked report + 12 tracked evidence files,
`npx prettier --check` on the report (exit 0), and `curl` on the deployed origin (HTTP 200). I also
re-derived the CTA, `aria-current`, overflow, warning and focus-ring numbers from the raw JSON, and
re-read `src/pages/work/index.astro` and `src/pages/research/index.astro` for DOM order.

The two round-1 blocking fixes are genuinely resolved, and I record that plainly because the verdict
is not about them:
- **Unreferenced artifacts (round-1 finding 1) — FIXED.** The new "Evidence index" (report:237-254)
  cites all 12 committed artifacts; every file has >=2 references in the report, including
  `deployed-vs-local-diff.json` and `deployed-work-1280.png`, which had zero before. AC14's four
  elements (pass/fail summary at report:3, severity-ranked findings at report:170/210, per-artifact
  links, and the recommendation at report:256-267) are all present.
- **CTA viewport qualifier (round-1 finding 2) — FIXED.** report:74-77 now reads "occurs at **all
  seven viewports** (91 of 294 rects)"; `responsive-sweep.json` confirms `boxH: 52` on 91 rects, 13
  per viewport at all seven widths, and `textLines: 1` on 294/294.
- **Focus ring (round-1 finding 3) — FIXED.** The newly committed `focus-visibility-probe.json`
  records `viaRealKeyEvents` = `solid 2px rgb(15, 91, 90)` on the EthioBio card link and
  `viaFocusMethod` = `outlineStyle: "none"`; the report cites it at report:88-95 and report:109.

AC status checks that pass: AC12 (diff is `docs/qa/**` only), AC13 (prettier exit 0), AC5/AC8 (AC11
recorded as a limitation at report:123-131, marked "not met" at report:231, "satisfied" appears only
in the negative at report:127), AC1-4, AC6, AC9-11 (form not submitted — no Formspree POST payload in
any artifact; origin 200).

## Findings

### blocking — docs/qa/ENG-109-post-ux-regression.md:111 (also :136)
The report states the `/work/` in-content "Start a Project" CTA "is reached in 8 tab stops" (line 111)
and is "reachable by keyboard in 8 tab stops" (line 136). That figure is contradicted by the report's
own evidence and by the page's DOM order:
- report:88 and the committed `docs/qa/evidence/ENG-109/focus-visibility-probe.json:25`
  (`"tabStopsFromTopToCardLink": 10`) place the card link at **10** tab stops on `/work/`.
- `src/pages/work/index.astro:43` emits `StatusFilter` (2 chips), `:45-54` the `ProjectCard` list
  (2 card links), and only then `:68` `StartProjectCta`. The in-content CTA therefore follows the
  card links, so it cannot be reached at 8 stops — 8 < 10 is impossible.
- The cited artifact `docs/qa/evidence/ENG-109/interaction-probes.json` `keyboardWork.seq` holds 8
  entries (`body`, Skip to content, wordmark, Solutions, Work, Research, About, `a:Start a Project`)
  and contains **no filter chips and no card links**; its final entry is the *nav* CTA. It is not a
  `/work/` sequence at all — the value 8 is the `/research/` sequence (research has no chips or
  cards), misattributed to `/work/`.

Why it matters: this is the same claim-not-readable-from-evidence pattern rounds 0 and 1 blocked on,
and it makes the report's own AC-table row "4 — keyboard/a11y checks with findings and severity →
met" (report:230) untrue: a stated keyboard figure contradicts report:88 and the committed probe.
The Requirement 6/7 *conclusion* (keyboard-reachable) still holds, but the recorded number is false
and is traceable to a mislabeled artifact field.
Remediation: state the `/work/` figure (12 tab stops) at report:111 and report:136, or say
`/research/` and cite the research tab order; reconcile both instances with report:88 /
`focus-visibility-probe.json:25`; and relabel or drop `interaction-probes.json`'s `keyboardWork`
block, whose `seq` is not a `/work/` sequence.

### blocking — docs/qa/ENG-109-post-ux-regression.md:104-113 (AC7)
AC7 requires the accessibility section to name each enumerated item, including "landmark/list
semantics" (Requirement 6: "landmark and list semantics"). The a11y table names "Landmark semantics
(header/nav/main/footer)" (report:106) but never addresses **list** semantics: the word "list"
appears nowhere in the report except an unrelated sentence (report:49), and no `ul`/`ol`/`li`/
`role="list"` result is recorded anywhere. The code carries a deliberate list-semantics decision —
`src/pages/work/index.astro:50-51` (`<ul class="project-grid" role="list">`, "the grid strips markers
with `list-style:none`, which drops list semantics in Safari/VoiceOver (ENG-103)") — which is exactly
what this check should record.
Why it matters: a literal, enumerable AC item is unnamed, so AC7 is not fully met and the deliverable
is incomplete for the accessibility-completeness lens the report exists to serve.
Remediation: add a row to the a11y table recording list semantics (the project grid's `role="list"`
and any `<ul>/<li>` nav/footer lists, with a pass/fail), backed by a `responsive-sweep.json` field.

## Not inspected
- The three PNGs (`local-work-320.png`, `local-work-1280.png`, `deployed-work-1280.png`) for rendered
  content — visual fidelity is the visual lens's scope; I checked presence, filename and reference only.
- The GitHub CI conclusion and run URL (report:40) — no network access to GitHub from this
  environment; the claim is recorded, not re-queried.
- The non-committed Node/CDP harness sources (they live outside the repo) — nothing committed to
  inspect; this is why the `Range.getClientRects()` / "real key events" prose cannot be reproduced
  from the change.
- I did not re-run `npm run verify`; the 455 tests / 14 pages / exit 0 / 12 `[WARN]` were read from
  `verify.log` and match the report.
