// pack/tools/lib/invariants.mjs
//
// The four invariants.
//
// Each function takes the opened job folder and returns the checks it made and
// the outcome they add up to. The outcome of an invariant is the WORST of its
// checks: a reject is worse than an inconclusive, and both are worse than a
// permit. Nothing here decides whether a job may advance on its own -- it
// reports what it found, and the CLI turns that into an exit code.
import { readFileSync } from "node:fs";
import { schemaPath } from "./pack-paths.mjs";
import { validate } from "../schema-validator.mjs";
import { gitBranchTip } from "./git.mjs";
import { worktreeOf } from "./change-identity.mjs";
import { evidenceRefs, parseRef } from "./refs.mjs";
import { ROLES, reviewerAgent } from "./job-folder.mjs";
import { INCONCLUSIVE, reason, worst } from "./reasons.mjs";
import { edgeKey, isConversational, loadTransitions } from "./state-machine.mjs";
import { PREDICATES } from "./transitions.mjs";

let schemas = null;
function loadSchemas() {
  if (schemas) return schemas;
  schemas = {
    job: JSON.parse(readFileSync(schemaPath("job.schema.json"), "utf8")),
    evidence: JSON.parse(readFileSync(schemaPath("evidence.schema.json"), "utf8")),
  };
  return schemas;
}

/**
 * The artifacts the job's current stage requires.
 *
 * The mapping is not invented here. It is the transition table's own triggers
 * (`spec.md`, `build.md`, the four verdict files, `decision.md`,
 * `evidence.json`) together with what the live harness asserts about a
 * capture: `build.md` from the stage the builder runs in onwards, and
 * `evidence.json` from the stage verification runs in onwards. It agrees with
 * `reference/status.md`, which reports "whether the artifact for the current
 * stage exists".
 *
 * The validator asks at the moment a transition is proposed, so the stage's
 * artifact must already be there. The live harness asks about a job that has
 * stopped, which is why its `build.md` rule covers every stage the builder
 * ever reached.
 */
export function stageArtifacts(context) {
  const round = context.round;
  const verdicts = round === null
    ? []
    : ROLES.map((role) => `round-${round}/review-${role}.md`);
  switch (context.record?.stage) {
    case "queued":
      return [];
    case "planning":
    case "awaiting_plan_approval":
      return ["spec.md"];
    case "building":
      return ["build.md"];
    case "verifying":
    case "repairing":
      return ["build.md", "evidence.json"];
    case "reviewing":
      return ["build.md", "evidence.json", ...verdicts];
    case "awaiting_human_review":
      return ["build.md", "evidence.json", ...verdicts, "decision.md"];
    case "approved_to_merge":
    case "handed_off":
    case "merged":
      return ["build.md", "evidence.json", ...verdicts, "decision.md"];
    default:
      // A job parked at a failure stage, or at a terminal stage with no row
      // behind it, is not advancing; nothing is required of it here.
      return [];
  }
}

// --- INV-01: legal state transitions ----------------------------------------

export function checkInv01(context, { to }) {
  const checks = [];
  if (!context.record) {
    const error = context.recordError ?? { reason: "unknown" };
    return {
      checks: [reason("INV-01/RECORD_UNREADABLE", { reason: error.reason })],
      outcome: INCONCLUSIVE,
    };
  }

  // A parked job carries a cause. The schema requires it too; stating it here
  // names the rule instead of leaving it to a schema rule. `needs_human` is
  // parked for a person, and a job parked with no stated reason is not
  // recoverable -- it is just parked.
  if (context.record.stage === "blocked") {
    const cause = context.record.cause;
    if (!(typeof cause === "string" && cause.trim().length > 0)) {
      checks.push(reason("INV-01/BLOCKED_CAUSE_MISSING", {}));
    }
  }
  if (context.record.stage === "needs_human") {
    const cause = context.record.cause;
    if (!(typeof cause === "string" && cause.trim().length > 0)) {
      checks.push(reason("INV-01/NEEDS_HUMAN_CAUSE_MISSING", {}));
    }
  }

  const from = context.record.stage;
  const transitions = loadTransitions();
  const row = transitions.rows.find((candidate) => candidate.from === from && candidate.to === to);

  if (!row) {
    checks.push(reason("INV-01/EDGE_UNKNOWN", { from, to }));
    return { checks, outcome: worst(checks) };
  }
  checks.push(reason("INV-01/EDGE_IN_TABLE", { from, to }));

  if (isConversational(row)) {
    checks.push(reason("INV-01/EDGE_CONVERSATIONAL", { from, to }));
    return { checks, outcome: worst(checks) };
  }

  const predicate = PREDICATES[edgeKey(from, to)];
  if (!predicate) {
    checks.push(reason("INV-01/EDGE_NOT_IMPLEMENTED", { from, to }));
    return { checks, outcome: worst(checks) };
  }

  checks.push(...predicate(context));
  return { checks, outcome: worst(checks) };
}

// --- INV-02: required artifacts exist and validate ---------------------------

export function checkInv02(context) {
  const checks = [];

  if (!context.record) {
    const error = context.recordError ?? { reason: "unknown" };
    if (error.kind === "missing") {
      checks.push(reason("INV-02/RECORD_MISSING", { path: error.path }));
    } else {
      checks.push(reason("INV-02/RECORD_UNREADABLE", { reason: error.reason }));
    }
    return { checks, outcome: worst(checks) };
  }

  const jobErrors = validate(loadSchemas().job, context.record);
  checks.push(jobErrors.length > 0
    ? reason("INV-02/RECORD_INVALID", { errors: jobErrors.join("; ") })
    : reason("INV-02/RECORD_VALID", {}));

  const artifacts = stageArtifacts(context);
  for (const artifact of artifacts) {
    const read = context.text(artifact);
    if (read.ok) {
      checks.push(reason("INV-02/ARTIFACT_PRESENT", { artifact }));
    } else if (read.kind === "missing") {
      checks.push(reason("INV-02/ARTIFACT_MISSING", { artifact }));
    } else {
      checks.push(reason("INV-02/ARTIFACT_UNREADABLE", { artifact, reason: read.reason }));
    }
  }

  // The evidence package, when the stage requires one, must also validate.
  if (artifacts.includes("evidence.json")) {
    const evidence = context.evidence();
    if (!evidence.ok) {
      if (evidence.kind === "unparseable") {
        checks.push(reason("INV-02/EVIDENCE_UNREADABLE", {
          reason: `it is not valid JSON (${evidence.reason})`,
        }));
      } else {
        checks.push(reason("INV-02/EVIDENCE_UNREADABLE", { reason: evidence.reason }));
      }
    } else {
      const evidenceErrors = validate(loadSchemas().evidence, evidence.value);
      checks.push(evidenceErrors.length > 0
        ? reason("INV-02/EVIDENCE_INVALID", { errors: evidenceErrors.join("; ") })
        : reason("INV-02/EVIDENCE_VALID", {}));
    }
  }

  return { checks, outcome: worst(checks) };
}

// --- INV-03: claimed verdicts have supporting evidence -----------------------

export function checkInv03(context) {
  const checks = [];
  const reviews = context.reviews();
  if (!reviews) {
    return { checks: [reason("INV-03/NO_REVIEWS", {})], outcome: INCONCLUSIVE };
  }

  const invocations = context.invocations();
  const sessionsByRole = new Map();

  // A record that claims no verdict has nothing to support. Saying so is
  // better than emitting a pass for a review that never happened -- but the
  // files still have to agree with the claims that are there, so the loop
  // below still runs.
  const claims = ROLES.map((role) => context.claim(role));
  const noClaims = !claims.some((claim) => claim !== null && claim !== "pending");

  for (const role of ROLES) {
    const claim = context.claim(role);
    const claimed = claim !== null && claim !== "pending";
    const verdict = context.verdict(role);

    if (!verdict) {
      if (claimed) {
        checks.push(reason("INV-03/VERDICT_FILE_UNREADABLE", {
          file: `round-?/review-${role}.md`,
          reason: "the record carries no round",
        }));
      }
      continue;
    }

    if (!verdict.ok) {
      if (claimed) {
        checks.push(verdict.kind === "missing"
          ? reason("INV-03/VERDICT_FILE_MISSING", { claim, role, file: verdict.file })
          : reason("INV-03/VERDICT_FILE_UNREADABLE", { file: verdict.file, reason: verdict.reason }));
      }
      continue;
    }

    if (verdict.malformed) {
      checks.push(reason("INV-03/VERDICT_MALFORMED", { file: verdict.file, first: verdict.first }));
      continue;
    }

    if (verdict.missingReason) {
      checks.push(reason("INV-03/NOT_APPLICABLE_WITHOUT_REASON", { role, file: verdict.file }));
      continue;
    }

    if (!claimed) {
      checks.push(reason("INV-03/VERDICT_UNRECORDED", {
        role,
        file: verdict.file,
        actual: verdict.verdict,
      }));
      continue;
    }

    if (claim !== verdict.verdict) {
      checks.push(reason("INV-03/VERDICT_MISMATCH", {
        claim,
        role,
        file: verdict.file,
        actual: verdict.verdict,
      }));
      continue;
    }

    if (claim === "PASS" && verdict.blocking) {
      checks.push(reason("INV-03/PASS_WITH_BLOCKING", { role, file: verdict.file }));
      continue;
    }

    if (claim === "CHANGES" && verdict.blockingCitations.length === 0) {
      checks.push(reason("INV-03/CHANGES_WITHOUT_BLOCKING", { role, file: verdict.file }));
      continue;
    }

    checks.push(reason("INV-03/VERDICT_AGREES", { role, claim, file: verdict.file }));

    // The session that produced this verdict.
    const agent = reviewerAgent(role);
    const mine = invocations.filter((invocation) => invocation?.agent === agent);
    if (mine.length === 0) {
      checks.push(reason("INV-03/NO_INVOCATION", { claim, role }));
      continue;
    }
    const sessions = [...new Set(mine.map((invocation) => invocation.session_id).filter(
      (session) => typeof session === "string" && session.length > 0))];
    if (sessions.length === 0) {
      checks.push(reason("INV-03/NO_INVOCATION", { claim, role }));
      continue;
    }
    sessionsByRole.set(role, sessions);
    checks.push(reason("INV-03/SESSION_RECORDED", { role, session: sessions[0] }));
  }

  // Independence: no two reviewers share a session.
  const roles = [...sessionsByRole.keys()];
  let shared = false;
  for (let i = 0; i < roles.length; i += 1) {
    for (let j = i + 1; j < roles.length; j += 1) {
      const a = roles[i];
      const b = roles[j];
      const common = sessionsByRole.get(a).filter((session) => sessionsByRole.get(b).includes(session));
      if (common.length > 0) {
        shared = true;
        checks.push(reason("INV-03/SHARED_SESSION", { a, b, session: common[0] }));
      }
    }
  }
  if (!shared && sessionsByRole.size > 0) {
    checks.push(reason("INV-03/SESSIONS_DISTINCT", { count: sessionsByRole.size }));
  } else if (noClaims) {
    checks.push(reason("INV-03/NO_CLAIMS", {}));
  }

  // The approver is not one of the reviewers.
  if (context.has("decision.md")) {
    const approvers = invocations.filter((invocation) => invocation?.agent === "approver");
    const reviewerSessions = new Set([...sessionsByRole.values()].flat());
    if (approvers.length === 0) {
      checks.push(reason("INV-03/DECISION_UNATTRIBUTED", { file: "decision.md" }));
    } else if (reviewerSessions.size === 0) {
      // No reviewer ran, so there is nothing for the approver to be separate
      // from. The decision is still unattributed to any review, and the
      // absence of a review is INV-02's and INV-01's business.
    } else {
      // EVERY approver invocation must be a session no reviewer used. Checking
      // only the first would let a second approver invocation -- a reviewer
      // wearing the approver's name -- slip past, and that is the whole thing
      // this check exists to catch: a reviewer resolving its own findings.
      const sessions = approvers.map((invocation) => invocation?.session_id).filter(Boolean);
      const collision = sessions.find((session) => reviewerSessions.has(session));
      if (collision) {
        checks.push(reason("INV-03/APPROVER_IS_REVIEWER", { session: collision }));
      } else {
        checks.push(reason("INV-03/APPROVER_SEPARATE", { session: sessions[0] }));
      }
    }
  }

  return { checks, outcome: worst(checks) };
}

// --- INV-04: verification evidence matches the current change ---------------

/**
 * The shape of a `diff_ref`.
 *
 * Two shapes exist in this pack and the pack never reconciles them: a range
 * `A..B` (the design spec's own example, `"39e1684..factory/001-about-faq"`)
 * and a single commit sha. Anything else has no canonical shape, and a ref
 * whose shape the pack does not define is never a permit. The parsing lives in
 * `refs.mjs`, because §14.2 precondition 6 asks the same question.
 */
export { parseRef };

export function checkInv04(context) {
  const checks = [];
  const evidence = context.evidence();
  if (!evidence.ok) {
    if (evidence.kind === "missing") {
      checks.push(reason("INV-04/EVIDENCE_MISSING", {}));
    } else {
      checks.push(reason("INV-04/EVIDENCE_UNREADABLE", { reason: evidence.reason }));
    }
    return { checks, outcome: worst(checks) };
  }

  const packageChecks = Array.isArray(evidence.value?.checks) ? evidence.value.checks : [];
  const worktree = worktreeOf(context);
  const refs = evidenceRefs(context, worktree);

  // Every ref that could not be read is reported by its own kind: a shape the
  // pack does not define and a commit this worktree does not know are two
  // different questions, and neither is a stale verdict.
  for (const problem of refs.problems) {
    checks.push(reason(problem.kind === "shape" ? "INV-04/REF_SHAPE_UNKNOWN" : "INV-04/REF_UNRESOLVABLE", {
      ref: problem.ref,
    }));
  }

  const targets = refs.targets;
  // Two refs that resolve to different commits disagree, and that is
  // decidable even when some other ref could not be resolved at all.
  const first = targets[0];
  const different = targets.find((target) => target.sha !== first?.sha);
  if (different) {
    checks.push(reason("INV-04/REF_DISAGREEMENT", {
      where: different.where,
      ref: different.ref,
      other: first.ref,
    }));
  } else if (refs.problems.length === 0 && targets.length > 0) {
    checks.push(reason("INV-04/REF_AGREEMENT", {}));

    if (!worktree.ok) {
      checks.push(reason("INV-04/WORKTREE_UNREADABLE", { reason: worktree.reason }));
    } else {
      // The change that is CURRENT is the one the job branch holds -- that is
      // what a push carries, and what an approval is bound to. The worktree's
      // HEAD is a different commit whenever the worktree is not on the
      // branch, and comparing against it would let evidence about one change
      // pass for another.
      const branch = gitBranchTip(worktree.path, context.record?.branch);
      if (!branch.ok) {
        checks.push(reason("INV-04/WORKTREE_UNREADABLE", { reason: branch.reason }));
      } else if (first.sha === branch.sha) {
        checks.push(reason("INV-04/REF_CURRENT", { target: first.sha }));
      } else {
        checks.push(reason("INV-04/REF_STALE", { target: first.sha, head: branch.sha }));
      }
    }
  }

  // A pass with no exit status is an unsupported pass.
  for (const check of packageChecks) {
    if (check?.result !== "passed") continue;
    if (check.exit_status !== null && check.exit_status !== undefined) continue;
    checks.push(reason("INV-04/PASS_WITHOUT_EXIT_STATUS", { check: check.check }));
  }

  return { checks, outcome: worst(checks) };
}
