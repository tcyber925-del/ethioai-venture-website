// pack/tools/lib/reasons.mjs
//
// Every reason the validator can produce, in one table.
//
// A check is not a free-text line: it is a code, an outcome and a message. The
// code is stable, the outcome is fixed per code, and the message is a template
// filled with the specifics of the run. Two things follow, and both matter:
//
//   - The outcome of a code can never change. A code that means "reject" is
//     only ever emitted as a reject. A reader who learns one code learns its
//     outcome for good.
//   - The reject codes and the inconclusive codes are disjoint. A reason can
//     never mean both "the inputs violate the invariant" and "the validator
//     could not decide", which is the confusion this tool exists to avoid.
//
// The registry is the tool's vocabulary. `pack/reference/validator.md`
// documents it, and the tests read it, so a new reason is a documented change
// rather than a surprise.

export const PERMIT = "permit";
export const REJECT = "reject";
export const INCONCLUSIVE = "inconclusive";

export const OUTCOMES = [PERMIT, REJECT, INCONCLUSIVE];

export const REASONS = Object.freeze({
  // --- INV-01: legal state transitions --------------------------------------
  "INV-01/EDGE_IN_TABLE": {
    outcome: PERMIT,
    text: "the transition `{from}` -> `{to}` is a row in `reference/state-machine.md`",
  },
  "INV-01/EDGE_UNKNOWN": {
    outcome: REJECT,
    text: "`{from}` -> `{to}` is not a row in `reference/state-machine.md`",
  },
  "INV-01/EDGE_CONVERSATIONAL": {
    outcome: INCONCLUSIVE,
    text: "`{from}` -> `{to}` is conversational: the document says no record exists at that stage, so there is nothing on disk to check",
  },
  "INV-01/EDGE_NOT_IMPLEMENTED": {
    outcome: INCONCLUSIVE,
    text: "the table has a `{from}` -> `{to}` row and this validator has no predicate for it",
  },
  "INV-01/FAILURE_STAGE_PERMITTED": {
    outcome: PERMIT,
    text: "a transition into `{to}` is always permitted: failing safe must never be blocked",
  },
  "INV-01/TRIGGER_SATISFIED": {
    outcome: PERMIT,
    text: "the trigger holds: {detail}",
  },
  "INV-01/TRIGGER_FALSE": {
    outcome: REJECT,
    text: "the trigger does not hold: {detail}",
  },
  "INV-01/TRIGGER_INPUT_MISSING": {
    outcome: REJECT,
    text: "the trigger's own condition is false: {artifact} does not exist",
  },
  "INV-01/TRIGGER_INPUT_UNREADABLE": {
    outcome: INCONCLUSIVE,
    text: "{artifact} cannot be read ({reason}), so the trigger cannot be evaluated",
  },
  "INV-01/PROTECTED_PATH_CHANGED": {
    outcome: REJECT,
    text: "the change touches protected {paths} -- a human must decide before verification",
  },
  "INV-01/RECORD_UNREADABLE": {
    outcome: INCONCLUSIVE,
    text: "the record cannot be read ({reason}), so the transition cannot be judged",
  },
  "INV-01/NOT_EVALUATED": {
    outcome: INCONCLUSIVE,
    text: "INV-01 was not asked: `--to <stage>` was not given, so no transition was checked. A run that did not ask the question cannot answer it, and an unanswered question is not a pass.",
  },
  "INV-01/BLOCKED_CAUSE_MISSING": {
    outcome: REJECT,
    text: "the record is at `blocked` and carries no cause",
  },
  "INV-01/NEEDS_HUMAN_CAUSE_MISSING": {
    outcome: REJECT,
    text: "the record is at `needs_human` and carries no cause",
  },
  "INV-01/PRECONDITION_HOLDS": {
    outcome: PERMIT,
    text: "§14.2 precondition {n} holds: {detail}",
  },
  "INV-01/PRECONDITION_FAILS": {
    outcome: REJECT,
    text: "§14.2 precondition {n} fails: {detail}",
  },
  "INV-01/PRECONDITION_NOT_IMPLEMENTED": {
    outcome: INCONCLUSIVE,
    text: "§14.2 precondition {n} ({name}) is not implemented: {detail}",
  },
  "INV-01/PRECONDITION_UNEVALUABLE": {
    outcome: INCONCLUSIVE,
    text: "§14.2 precondition {n} cannot be evaluated: {detail}",
  },
  "INV-01/HANDOFF_UNVERIFIABLE": {
    outcome: INCONCLUSIVE,
    text: "{detail}",
  },

  // --- INV-02: required artifacts exist and validate -------------------------
  "INV-02/RECORD_VALID": {
    outcome: PERMIT,
    text: "the record validates against `schemas/job.schema.json`",
  },
  "INV-02/RECORD_INVALID": {
    outcome: REJECT,
    text: "the record does not validate against `schemas/job.schema.json`: {errors}",
  },
  "INV-02/RECORD_UNREADABLE": {
    outcome: INCONCLUSIVE,
    text: "the record cannot be read ({reason}), so the invariant cannot be judged",
  },
  "INV-02/RECORD_MISSING": {
    outcome: INCONCLUSIVE,
    text: "the record is missing ({path}), so the invariant cannot be judged",
  },
  "INV-02/EVIDENCE_VALID": {
    outcome: PERMIT,
    text: "the evidence package validates against `schemas/evidence.schema.json`",
  },
  "INV-02/EVIDENCE_INVALID": {
    outcome: REJECT,
    text: "the evidence package does not validate against `schemas/evidence.schema.json`: {errors}",
  },
  "INV-02/EVIDENCE_UNREADABLE": {
    outcome: INCONCLUSIVE,
    text: "the evidence package cannot be read ({reason}), so it cannot be validated",
  },
  "INV-02/ARTIFACT_PRESENT": {
    outcome: PERMIT,
    text: "{artifact} exists",
  },
  "INV-02/ARTIFACT_MISSING": {
    outcome: REJECT,
    text: "{artifact} is missing",
  },
  "INV-02/ARTIFACT_UNREADABLE": {
    outcome: INCONCLUSIVE,
    text: "{artifact} cannot be read ({reason})",
  },

  // --- INV-03: claimed verdicts have supporting evidence -------------------
  "INV-03/VERDICT_AGREES": {
    outcome: PERMIT,
    text: "{role}: the record claims `{claim}` and {file} agrees",
  },
  "INV-03/VERDICT_FILE_MISSING": {
    outcome: REJECT,
    text: "the record claims `{claim}` for `{role}` but {file} does not exist",
  },
  "INV-03/VERDICT_FILE_UNREADABLE": {
    outcome: INCONCLUSIVE,
    text: "{file} cannot be read ({reason}), so the claim cannot be checked",
  },
  "INV-03/VERDICT_MALFORMED": {
    outcome: REJECT,
    text: "{file} opens with `{first}` -- not `VERDICT: PASS | CHANGES | NOT_APPLICABLE`",
  },
  "INV-03/VERDICT_MISMATCH": {
    outcome: REJECT,
    text: "the record claims `{claim}` for `{role}` but {file} says `VERDICT: {actual}`",
  },
  "INV-03/VERDICT_UNRECORDED": {
    outcome: REJECT,
    text: "the record claims `pending` for `{role}` but {file} says `VERDICT: {actual}` -- the record and the artifact disagree",
  },
  "INV-03/PASS_WITH_BLOCKING": {
    outcome: REJECT,
    text: "the record claims `PASS` for `{role}` but {file} carries a blocking finding",
  },
  "INV-03/CHANGES_WITHOUT_BLOCKING": {
    outcome: REJECT,
    text: "the record claims `CHANGES` for `{role}` but {file} carries no blocking finding cited as `file:line`",
  },
  "INV-03/SESSION_RECORDED": {
    outcome: PERMIT,
    text: "{role}: the record names the invocation that produced the verdict (session `{session}`)",
  },
  "INV-03/NO_INVOCATION": {
    outcome: REJECT,
    text: "the record claims `{claim}` for `{role}` but names no `reviewer-{role}` invocation",
  },
  "INV-03/SESSIONS_DISTINCT": {
    outcome: PERMIT,
    text: "the reviewers that produced verdicts ran in {count} distinct sessions",
  },
  "INV-03/SHARED_SESSION": {
    outcome: REJECT,
    text: "`{a}` and `{b}` share the session `{session}` -- the review round's independence is gone",
  },
  "INV-03/APPROVER_SEPARATE": {
    outcome: PERMIT,
    text: "the approver ran in its own session `{session}`",
  },
  "INV-03/APPROVER_IS_REVIEWER": {
    outcome: REJECT,
    text: "the approver's session `{session}` is a reviewer's session -- a reviewer may not resolve its own findings",
  },
  "INV-03/DECISION_UNATTRIBUTED": {
    outcome: REJECT,
    text: "{file} exists but the record names no `approver` invocation that could have written it",
  },
  "INV-03/NO_REVIEWS": {
    outcome: INCONCLUSIVE,
    text: "the record carries no `reviews` object, so no claimed verdict can be checked",
  },
  "INV-03/NO_CLAIMS": {
    outcome: PERMIT,
    text: "no review verdict is claimed, so there is nothing to check",
  },
  "INV-03/NOT_APPLICABLE_WITHOUT_REASON": {
    outcome: REJECT,
    text: "the record claims `NOT_APPLICABLE` for `{role}` but {file} states no reason, which `reference/review.md` calls malformed",
  },

  // --- INV-04: verification evidence matches the current change -------------
  "INV-04/REF_AGREEMENT": {
    outcome: PERMIT,
    text: "the package's `diff_ref` and every check's `diff_ref` name the same change",
  },
  "INV-04/REF_DISAGREEMENT": {
    outcome: REJECT,
    text: "`{where}` names `{ref}`, which is not the change the package names (`{other}`)",
  },
  "INV-04/REF_SHAPE_UNKNOWN": {
    outcome: INCONCLUSIVE,
    text: "`{ref}` is neither a range `A..B` nor a single commit sha -- the pack has no canonical shape for it",
  },
  "INV-04/REF_UNRESOLVABLE": {
    outcome: INCONCLUSIVE,
    text: "`{ref}` cannot be resolved to a commit in the job's worktree",
  },
  "INV-04/REF_CURRENT": {
    outcome: PERMIT,
    text: "the evidence names `{target}`, which is the job branch's current HEAD",
  },
  "INV-04/REF_STALE": {
    outcome: REJECT,
    text: "the evidence names `{target}` but the job branch's current HEAD is `{head}` -- the evidence is stale",
  },
  "INV-04/WORKTREE_UNREADABLE": {
    outcome: INCONCLUSIVE,
    text: "the job branch's tip cannot be read ({reason})",
  },
  "INV-04/EVIDENCE_MISSING": {
    outcome: REJECT,
    text: "the evidence package is missing, so there is nothing to compare against the current change",
  },
  "INV-04/EVIDENCE_UNREADABLE": {
    outcome: INCONCLUSIVE,
    text: "the evidence package cannot be read ({reason})",
  },
  "INV-04/PASS_WITHOUT_EXIT_STATUS": {
    outcome: REJECT,
    text: "the check `{check}` is `passed` with no exit status -- an unsupported pass",
  },
});

/** Every code whose outcome is `outcome`. */
export const codesWithOutcome = (outcome) =>
  Object.keys(REASONS).filter((code) => REASONS[code].outcome === outcome);

/**
 * Build one check from a registry code.
 *
 * The code is the check's `id`, so the JSON output names the reason rather
 * than repeating prose, and the tests can compare codes directly.
 */
export function reason(code, vars = {}) {
  const entry = REASONS[code];
  if (!entry) throw new Error(`unknown reason code: ${code}`);
  const detail = entry.text.replace(/\{(\w+)\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : "");
  return { id: code, outcome: entry.outcome, detail };
}

/**
 * The outcome of a set of checks: the worst one.
 *
 * A reject is worse than an inconclusive: it says the inputs violate the
 * invariant, which is a firmer answer than "could not decide". Both block
 * protected progress, and neither is ever a permit.
 */
export function worst(checks) {
  if (checks.some((check) => check.outcome === REJECT)) return REJECT;
  if (checks.some((check) => check.outcome === INCONCLUSIVE)) return INCONCLUSIVE;
  return PERMIT;
}
