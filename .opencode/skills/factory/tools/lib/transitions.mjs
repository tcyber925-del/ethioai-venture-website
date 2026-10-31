// pack/tools/lib/transitions.mjs
//
// The predicate for every implemented row of the transition table.
//
// A transition is checked as a PROPOSED transition: "may this job move from
// stage X to stage Y, given what is on disk right now?". The record holds no
// transition history, so there is nothing else to ask.
//
// Each predicate reads the trigger column of its own row and turns it into a
// question about the job folder. The wording of the trigger is the
// specification; this file is only its reading.
//
// Three rules hold for every predicate:
//
//   - A missing artifact a trigger presupposes makes the trigger FALSE: the
//     row says the artifact is there, and it is not. That is a reject.
//   - An artifact that exists but cannot be read or parsed makes the trigger
//     UNDECIDABLE: the validator cannot decide, and an undecided question is
//     never a permit.
//   - A transition into a failure stage (`needs_human`, `blocked`) is always
//     permitted. Failing safe must never be blocked.
import { ROLES } from "./job-folder.mjs";
import { gitDiffNames, gitHead, gitRevParse } from "./git.mjs";
import { changeIdentity, worktreeOf, worktreeSafety } from "./change-identity.mjs";
import { matchesProtectedPath, checkPolicyBinding } from "./profile.mjs";
import { implementedPreconditions, runPreconditions } from "./preconditions.mjs";
import { reason } from "./reasons.mjs";

const satisfied = (detail) => [reason("INV-01/TRIGGER_SATISFIED", { detail })];
const unsatisfied = (detail) => [reason("INV-01/TRIGGER_FALSE", { detail })];

/**
 * Read an artifact a trigger presupposes.
 *
 * `use` receives the file's text and returns the checks for a readable file.
 */
function withArtifact(context, rel, use) {
  const read = context.text(rel);
  if (!read.ok) {
    return read.kind === "missing"
      ? [reason("INV-01/TRIGGER_INPUT_MISSING", { artifact: rel })]
      : [reason("INV-01/TRIGGER_INPUT_UNREADABLE", { artifact: rel, reason: read.reason })];
  }
  return use(read.text);
}

/** The evidence package, or the reason the trigger cannot be evaluated. */
function withEvidence(context, use) {
  const evidence = context.evidence();
  if (!evidence.ok) {
    return evidence.kind === "missing"
      ? [reason("INV-01/TRIGGER_INPUT_MISSING", { artifact: "evidence.json" })]
      : [reason("INV-01/TRIGGER_INPUT_UNREADABLE", {
          artifact: "evidence.json",
          reason: evidence.reason,
        })];
  }
  const checks = Array.isArray(evidence.value?.checks) ? evidence.value.checks : [];
  return use(checks);
}

/** A transition into a failure stage: always permitted. */
const failureStage = (to) => [
  reason("INV-01/FAILURE_STAGE_PERMITTED", { to }),
];

/**
 * The paths that changed between the recorded base and HEAD, or why they
 * cannot be read.
 *
 * The worktree is already known to be clean and on the job branch when this
 * runs, so HEAD is the branch's own commit. The diff still uses the recorded
 * base commit, not the base branch's current tip: the change being verified
 * is what this branch added to the commit it was cut from.
 */
function changedPaths(context) {
  const worktree = worktreeOf(context);
  if (!worktree.ok) return { ok: false, reason: worktree.reason };
  const baseCommit = context.record?.base_commit;
  if (typeof baseCommit !== "string" || baseCommit.trim().length === 0) {
    return { ok: false, reason: "the record names no base commit" };
  }
  const base = gitRevParse(worktree.path, baseCommit);
  if (!base.ok) {
    return {
      ok: false,
      reason: `the recorded base commit \`${baseCommit}\` cannot be resolved (${base.reason})`,
    };
  }
  const head = gitHead(worktree.path);
  if (!head.ok) return { ok: false, reason: `HEAD cannot be read (${head.reason})` };
  const diff = gitDiffNames(worktree.path, base.sha, head.sha);
  if (!diff.ok) return { ok: false, reason: diff.reason };
  return { ok: true, paths: diff.paths };
}

/**
 * The profile's effective `protected_paths` against the change.
 *
 * The effective list always includes `.factory/profile.md` and
 * `.factory/policies/**`, so the policy files are protected even when the
 * profile says `none`.
 *
 * The decision is taken against the policy the job BOUND at claim, and the
 * binding must still match the profile on disk. A policy that moved, a
 * binding that omits the floor, or a job with no binding (never claimed, or
 * claimed before bindings existed), is inconclusive -- never a permit.
 *
 * A hit is a reject; a policy or a diff that cannot be read is undecidable.
 * An empty policy is the only way to reach a permit without reading the diff,
 * and it must still come from a section that parsed.
 */
function protectedPathCheck(context) {
  const bound = checkPolicyBinding(context.record?.policy, context.repoRoot);
  if (!bound.ok) {
    return { ok: false, artifact: "the profile's `protected_paths`", reason: bound.reason };
  }
  const patterns = bound.patterns;
  if (patterns.length === 0) {
    return { ok: true, hits: [], detail: "the profile protects no paths" };
  }
  const changed = changedPaths(context);
  if (!changed.ok) {
    return { ok: false, artifact: "the change's paths", reason: changed.reason };
  }
  const hits = [];
  for (const path of changed.paths) {
    const pattern = patterns.find((candidate) => matchesProtectedPath(candidate, path));
    if (pattern) hits.push({ path, pattern });
  }
  return {
    ok: true,
    hits,
    detail: "no changed path matches the profile's `protected_paths`",
  };
}

/**
 * The predicates, keyed by `from>to`.
 *
 * Every implemented row of the table has one. A row without one is reported
 * as not implemented rather than quietly permitted -- and the drift test in
 * the repository's `tests/validator.test.mjs` fails when the table gains a
 * row this file does not know about.
 */
export const PREDICATES = Object.freeze({
  // "`/factory dispatch` claims the job"
  "queued>planning": (context) => {
    const branch = context.record?.branch;
    const worktree = context.record?.worktree;
    if (typeof branch !== "string" || branch.trim().length === 0) {
      return unsatisfied("the record names no branch for the claim to take");
    }
    if (typeof worktree !== "string" || worktree.trim().length === 0) {
      return unsatisfied("the record names no worktree for the claim to take");
    }
    return satisfied(`the record names the branch \`${branch}\` and the worktree \`${worktree}\``);
  },

  // "Herdr workspace creation fails -- repository state preserved, cause recorded"
  "planning>blocked": () => failureStage("blocked"),

  // "tier is `approval` and `spec.md` exists"
  "planning>awaiting_plan_approval": (context) => {
    const tier = context.record?.risk_tier;
    if (tier !== "approval") {
      return unsatisfied(`the tier is \`${tier}\`, not \`approval\``);
    }
    return withArtifact(context, "spec.md", () => satisfied("the tier is `approval` and `spec.md` exists"));
  },

  // "`spec.md` exists, and either the tier is not `approval` or `/factory go`
  //  recorded `spec_approved`"
  "planning>building": (context) => {
    const tier = context.record?.risk_tier;
    if (tier === "approval" && context.record?.spec_approved !== true) {
      return unsatisfied("the tier is `approval` and no `spec_approved` was recorded");
    }
    return withArtifact(context, "spec.md", () =>
      satisfied(
        tier === "approval"
          ? "`spec_approved` is recorded and `spec.md` exists"
          : `the tier is \`${tier}\` and \`spec.md\` exists`,
      ));
  },

  // "`/factory go <job-id>` records `spec_approved`"
  "awaiting_plan_approval>building": (context) =>
    context.record?.spec_approved === true
      ? satisfied("the record says `spec_approved`")
      : unsatisfied("the record does not say `spec_approved`"),

  // "`build.md` first line is `STATUS: READY`, the worktree is clean,
  //  `HEAD` is the job branch's own commit, and no changed path matches the
  //  profile's `protected_paths`"
  "building>verifying": (context) =>
    withArtifact(context, "build.md", (text) => {
      const first = text.split("\n", 1)[0].trim();
      if (first !== "STATUS: READY") {
        return unsatisfied(`\`build.md\` opens with \`${first}\``);
      }
      const safety = worktreeSafety(context);
      if (safety.undecidable) {
        return [reason("INV-01/TRIGGER_INPUT_UNREADABLE", {
          artifact: "the job worktree",
          reason: safety.detail,
        })];
      }
      if (!safety.holds) return unsatisfied(safety.detail);
      const protection = protectedPathCheck(context);
      if (!protection.ok) {
        return [reason("INV-01/TRIGGER_INPUT_UNREADABLE", {
          artifact: protection.artifact,
          reason: protection.reason,
        })];
      }
      if (protection.hits.length > 0) {
        const paths = protection.hits
          .map(({ path, pattern }) => `\`${path}\` (matches \`${pattern}\`)`)
          .join(", ");
        return [reason("INV-01/PROTECTED_PATH_CHANGED", { paths })];
      }
      return satisfied(
        `\`build.md\` opens with \`STATUS: READY\`; ${safety.detail}; ${protection.detail}`,
      );
    }),

  // "`build.md` first line is `STATUS: BLOCKED`" -- a failure stage.
  "building>needs_human": () => failureStage("needs_human"),

  // "a check failed and `retries_left` remains"
  "verifying>repairing": (context) =>
    withEvidence(context, (checks) => {
      const failed = checks.find((check) => check?.result === "failed");
      if (!failed) return unsatisfied("no check failed");
      // The budget as it stood BEFORE this write spends it: a retry that
      // remains is one the budget had, not one the write leaves behind.
      const retries = context.current?.retries_left;
      if (!(typeof retries === "number" && retries > 0)) {
        return unsatisfied("the retry budget is exhausted");
      }
      return satisfied(`the check \`${failed.check}\` failed and ${retries} retries remain`);
    }),

  // "every check is `passed` or `not_applicable`"
  "verifying>reviewing": (context) =>
    withEvidence(context, (checks) => {
      if (checks.length === 0) return unsatisfied("the evidence package records no check");
      const other = checks.find((check) =>
        check?.result !== "passed" && check?.result !== "not_applicable");
      if (other) {
        return unsatisfied(`the check \`${other.check}\` is \`${other.result}\``);
      }
      return satisfied(`${checks.length} checks are all \`passed\` or \`not_applicable\``);
    }),

  // "a check is `blocked` or `not_run`, or retries are exhausted" -- a failure stage.
  "verifying>needs_human": () => failureStage("needs_human"),

  // "evidence could not be written" -- a failure stage.
  "verifying>blocked": () => failureStage("blocked"),

  // "the orchestrator re-dispatches the builder with the failing check's output"
  "repairing>building": (context) =>
    withEvidence(context, (checks) => {
      const failed = checks.find((check) => check?.result === "failed");
      if (!failed) return unsatisfied("the evidence names no failed check to hand to the builder");
      return satisfied(`the evidence names the failed check \`${failed.check}\``);
    }),

  // "the repair was driven by a review `CHANGES` verdict, so the round re-runs"
  // A review-triggered repair has no failed check to hand the builder -- the
  // gate passed -- so this exit returns the job to the round it came from.
  "repairing>reviewing": () => [satisfied("the review round re-runs after the repair")],

  // "all four verdict files exist, none carries a blocking finding, and `decision.md` says APPROVE"
  "reviewing>awaiting_human_review": (context) => {
    if (context.round === null) {
      return unsatisfied("the record carries no round, so the verdict files cannot be found");
    }
    for (const role of ROLES) {
      const verdict = context.verdict(role);
      if (!verdict) return unsatisfied("the record carries no round, so the verdict files cannot be found");
      if (!verdict.ok) {
        return verdict.kind === "missing"
          ? [reason("INV-01/TRIGGER_INPUT_MISSING", { artifact: verdict.file })]
          : [reason("INV-01/TRIGGER_INPUT_UNREADABLE", {
              artifact: verdict.file,
              reason: verdict.reason,
            })];
      }
      if (verdict.malformed) {
        return unsatisfied(`\`${verdict.file}\` opens with \`${verdict.first}\``);
      }
      if (verdict.blocking) {
        return unsatisfied(`\`${verdict.file}\` carries a blocking finding`);
      }
      // The record must CLAIM what the files say. A record that still says
      // `pending` for a verdict that was returned is a record that does not
      // describe the job, and the reviewer that produced it is unaccounted
      // for. A live run found exactly this: the verdict files were there and
      // the record said nothing had been reviewed.
      const claimed = context.record?.reviews?.[role];
      const returned = verdict.verdict;
      if (claimed !== returned) {
        return unsatisfied(
          `the record claims \`${claimed ?? "nothing"}\` for the \`${role}\` review, but \`${verdict.file}\` says \`${returned}\``);
      }
    }
    return withArtifact(context, "decision.md", (text) => {
      const first = text.split("\n", 1)[0].trim();
      return first === "DECISION: APPROVE"
        ? satisfied("all four verdict files exist, the record claims exactly them, none carries a blocking finding, and `decision.md` says APPROVE")
        : unsatisfied(`\`decision.md\` opens with \`${first}\``);
    });
  },

  // "any verdict carries a blocking finding and `retries_left` remains"
  "reviewing>repairing": (context) => {
    if (context.round === null) {
      return unsatisfied("the record carries no round, so the verdict files cannot be found");
    }
    let blocking = null;
    for (const role of ROLES) {
      const verdict = context.verdict(role);
      if (!verdict || !verdict.ok) continue;
      if (verdict.blocking) {
        blocking = verdict;
        break;
      }
    }
    if (!blocking) return unsatisfied("no verdict carries a blocking finding");
    // The budget as it stood BEFORE this write spends it.
    const retries = context.current?.retries_left;
    if (!(typeof retries === "number" && retries > 0)) {
      return unsatisfied("the retry budget is exhausted");
    }
    return satisfied(`\`${blocking.file}\` carries a blocking finding and ${retries} retries remain`);
  },

  // "blocking findings remain and `retries_left` is exhausted, or `decision.md` says ESCALATE"
  "reviewing>needs_human": () => failureStage("needs_human"),

  // "every §14.2 precondition holding" -- all six are implemented, and two of
  // them are about the identity of the change.
  "awaiting_human_review>approved_to_merge": (context) => runPreconditions(context),

  // "the approved `diff_ref` no longer matches the current diff -- approval is stale"
  //
  // The trigger IS the identity check: the approval names a commit, the
  // worktree names another, and the difference is what makes the approval
  // stale. The approval is read from the record, so the row is asked while the
  // stale binding is still on disk -- which is why the approval is recorded
  // before the stage advances.
  "awaiting_human_review>reviewing": (context) => {
    const approval = context.record?.approval;
    if (!approval || approval.approved !== true ||
        typeof approval.diff_ref !== "string" || approval.diff_ref.trim().length === 0) {
      return unsatisfied("the record carries no live approval, so no approval can be stale");
    }
    const current = changeIdentity(context);
    if (!current.ok) {
      return [reason("INV-01/PRECONDITION_UNEVALUABLE", { n: 1, detail: current.reason })];
    }
    const approved = gitRevParse(current.worktree, approval.diff_ref);
    if (!approved.ok) {
      return [reason("INV-01/PRECONDITION_UNEVALUABLE", {
        n: 1,
        detail: `the approved diff_ref cannot be resolved (${approved.reason})`,
      })];
    }
    if (approved.sha === current.identity.head_commit) {
      return unsatisfied(
        `the approved diff_ref still matches the current change \`${current.identity.head_commit}\``);
    }
    return satisfied(
      `the approved diff_ref \`${approved.sha}\` no longer matches the current change ` +
      `\`${current.identity.head_commit}\` -- the approval is stale`);
  },

  // "the full gate passes and the pull request is opened"
  //
  // Both facts are read from the record: the full gate's recorded result, and
  // the handoff the guarded tool recorded when it pushed the job branch and
  // opened the pull request. A transition whose outcome the record does not
  // support is not a transition this pack may report.
  "approved_to_merge>handed_off": (context) => {
    const checks = [...runPreconditions(context)];

    const fullGate = context.record?.full_gate;
    if (!fullGate || typeof fullGate !== "object") {
      checks.push(reason("INV-01/HANDOFF_UNVERIFIABLE", {
        detail: "the full gate's result is not recorded in the job folder, so it cannot be checked read-only",
      }));
    } else if (fullGate.result !== "passed") {
      checks.push(...unsatisfied(`the full gate is \`${fullGate.result}\``));
    } else {
      checks.push(...satisfied("the full gate is recorded as `passed`"));
    }

    const handoff = context.record?.handoff;
    if (!handoff || typeof handoff !== "object") {
      checks.push(...unsatisfied("the record carries no handoff: no pull request was opened"));
    } else if (handoff.pushed !== true) {
      checks.push(...unsatisfied("the record's handoff says the job branch was not pushed"));
    } else if (typeof handoff.pr_url !== "string" || handoff.pr_url.trim().length === 0) {
      checks.push(...unsatisfied("the record's handoff carries no pull request"));
    } else {
      checks.push(...satisfied(`the job branch was pushed and the pull request was opened (${handoff.pr_url})`));
    }

    return checks;
  },

  // "a §14.2 precondition fails at handoff; the approval is cleared"
  //
  // All six preconditions are implemented now, so a failing one can be
  // established -- and a precondition that cannot be judged cannot.
  "approved_to_merge>awaiting_human_review": (context) => {
    const results = implementedPreconditions(context);
    const failed = results.find((entry) => entry.result.holds === false);
    if (failed) {
      return satisfied(
        `§14.2 precondition ${failed.n} fails (${failed.result.detail}), so the pending handoff is invalid and the approval is cleared`);
    }
    const undecidable = results.find((entry) => entry.result.undecidable);
    if (undecidable) {
      return [reason("INV-01/PRECONDITION_UNEVALUABLE", {
        n: undecidable.n,
        detail: undecidable.result.detail,
      })];
    }
    return unsatisfied("every §14.2 precondition holds, so no failing precondition clears the approval");
  },
});
