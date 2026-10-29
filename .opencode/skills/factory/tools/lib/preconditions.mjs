// pack/tools/lib/preconditions.mjs
//
// The six §14.2 preconditions from `reference/approval.md`.
//
// All six are checkable from the record, the artifacts and the job's git
// state, and all six are implemented here.
//
// Two of them -- "approval is bound to the current `diff_ref`" and "the
// current diff matches the reviewed and approved change" -- are about the
// IDENTITY OF THE CHANGE, and they are computed by `change-identity.mjs`:
// the same identity the protected-action boundary checks before it pushes.
//
// A precondition that cannot be judged returns `undecidable`, and an
// undecidable precondition never authorises progress. A precondition that
// FAILS blocks it too, and says which fact failed -- the difference is what a
// human is told.
import { gitIsAncestor, gitRevParse, gitUnmergedPaths } from "./git.mjs";
import { ROLES } from "./job-folder.mjs";
import { changeIdentity, checkBinding, worktreeOf, worktreeSafety } from "./change-identity.mjs";
import { evidenceRefs } from "./refs.mjs";
import { reason } from "./reasons.mjs";

/** The stages a job is parked at when it cannot proceed. */
export const FAILURE_STAGES = Object.freeze(["needs_human", "blocked"]);

/**
 * The registry. Every precondition is here, implemented or not.
 *
 * An implemented precondition returns one of:
 *   { holds: true, detail }      -- it holds
 *   { holds: false, detail }     -- it fails
 *   { undecidable: true, detail} -- it cannot be judged from what is on disk
 */
export const PRECONDITIONS = Object.freeze([
  {
    n: 1,
    name: "approval is explicit, current, and bound to the current `diff_ref`",
    status: "implemented",
    check(context) {
      const approval = context.record?.approval;
      if (!approval || approval.approved !== true) {
        return { holds: false, detail: "the record carries no approval" };
      }
      if (typeof approval.diff_ref !== "string" || approval.diff_ref.trim().length === 0) {
        return { holds: false, detail: "the approval records no diff reference" };
      }
      // "Approval must be explicit and must name the job and the change": a
      // binding that names no job, or another job, authorises nothing.
      if (typeof approval.job !== "string" || approval.job.trim().length === 0) {
        return { holds: false, detail: "the approval names no job" };
      }
      if (approval.job !== context.record?.id) {
        return {
          holds: false,
          detail: `the approval names job \`${approval.job}\`, not \`${context.record?.id}\``,
        };
      }
      if (typeof approval.approver !== "string" || approval.approver.trim().length === 0) {
        return { holds: false, detail: "the approval names no approver" };
      }
      return checkBinding(context, { approval });
    },
  },
  {
    n: 2,
    name: "the required verification and review gates are complete",
    status: "implemented",
    check(context) {
      const evidence = context.evidence();
      if (!evidence.ok) {
        return {
          undecidable: true,
          detail: evidence.kind === "missing"
            ? "the evidence package is missing, so the verification gate cannot be judged"
            : `the evidence package cannot be read (${evidence.reason})`,
        };
      }
      const checks = Array.isArray(evidence.value?.checks) ? evidence.value.checks : [];
      const incomplete = checks.filter((check) =>
        check?.result === "not_run" || check?.result === "blocked");
      if (incomplete.length > 0) {
        return {
          holds: false,
          detail: `the check \`${incomplete[0].check}\` is \`${incomplete[0].result}\``,
        };
      }
      const reviews = context.reviews();
      if (!reviews) {
        return { holds: false, detail: "the record carries no `reviews` object" };
      }
      const pending = ROLES.filter((role) => reviews[role] === undefined || reviews[role] === "pending");
      if (pending.length > 0) {
        return {
          holds: false,
          detail: `the \`${pending[0]}\` review is still \`pending\``,
        };
      }
      return { holds: true, detail: "no check is `not_run` or `blocked`, and all four reviews returned" };
    },
  },
  {
    n: 3,
    name: "the base branch is known and has not moved unexpectedly",
    status: "implemented",
    check(context) {
      const baseBranch = context.record?.base_branch;
      const baseCommit = context.record?.base_commit;
      // A base that is not recorded is a MISSING INPUT, not a moved base: the
      // check cannot be performed, and an unanswered question is not a failure
      // of the change -- it is a question. Either way it blocks.
      if (typeof baseBranch !== "string" || baseBranch.trim().length === 0) {
        return { undecidable: true, detail: "the record names no base branch" };
      }
      if (typeof baseCommit !== "string" || baseCommit.trim().length === 0) {
        return { undecidable: true, detail: "the record names no base commit" };
      }
      const worktree = worktreeOf(context);
      if (!worktree.ok) {
        return { undecidable: true, detail: worktree.reason };
      }
      const branch = gitRevParse(worktree.path, baseBranch);
      if (!branch.ok) {
        return { holds: false, detail: `the base branch \`${baseBranch}\` does not exist in the worktree` };
      }
      const commit = gitRevParse(worktree.path, baseCommit);
      if (!commit.ok) {
        return { holds: false, detail: `the recorded base commit \`${baseCommit}\` is not in the worktree` };
      }
      // "Has not moved" is read as: the base branch is still where the record
      // says it was. `approval.md` and `state-machine.md`'s sixth invariant
      // both say a moved base invalidates a pending handoff, and a base that
      // moved forward is a moved base.
      if (branch.sha !== commit.sha) {
        const ancestor = gitIsAncestor(worktree.path, commit.sha, branch.sha);
        if (!ancestor.ok) {
          return { undecidable: true, detail: ancestor.reason };
        }
        return {
          holds: false,
          detail: ancestor.ancestor
            ? `the base branch \`${baseBranch}\` moved: it is at \`${branch.sha}\`, not the recorded \`${commit.sha}\``
            : `the base branch \`${baseBranch}\` was rewritten: it no longer contains the recorded \`${commit.sha}\``,
        };
      }
      return { holds: true, detail: `the base branch is \`${baseBranch}\` at \`${commit.sha}\`, unmoved` };
    },
  },
  {
    n: 4,
    name: "the working tree meets the merge mechanism's safety requirements",
    status: "implemented",
    check(context) {
      // The merge mechanism's safety requirement is that the tree being
      // handed over is the tree that was reviewed: a clean tracked tree, on
      // the job branch's own commit. The same check runs before verification
      // (`transitions.mjs`), so a review round cannot be spent on a tree the
      // handoff would refuse.
      return worktreeSafety(context);
    },
  },
  {
    n: 5,
    name: "there is no unresolved conflict",
    status: "implemented",
    check(context) {
      const worktree = worktreeOf(context);
      if (!worktree.ok) return { undecidable: true, detail: worktree.reason };
      const conflicts = gitUnmergedPaths(worktree.path);
      if (!conflicts.ok) return { undecidable: true, detail: conflicts.reason };
      if (conflicts.paths.length > 0) {
        return { holds: false, detail: `the path \`${conflicts.paths[0]}\` is unmerged` };
      }
      return { holds: true, detail: "no path is left unmerged" };
    },
  },
  {
    n: 6,
    name: "the current diff matches the reviewed and approved change",
    status: "implemented",
    check(context) {
      // The change that was verified and reviewed is the change the evidence
      // names; the change being approved is the change the JOB BRANCH holds,
      // because that is what a push carries.
      //
      // Precondition 1 binds the approval to the branch's tip, so the
      // evidence must name that same commit for the loop to close. It used
      // to be compared with the worktree's HEAD instead -- and those two are
      // not the same commit when the worktree is detached at an older one,
      // which is the exact hole the change identity was introduced to close.
      // A worktree that is not on the branch is precondition 4's business.
      const current = changeIdentity(context);
      if (!current.ok) return { undecidable: true, detail: current.reason };

      const worktree = worktreeOf(context);
      const refs = evidenceRefs(context, worktree);
      if (refs.missing) {
        return { undecidable: true, detail: "the evidence package is missing" };
      }
      if (refs.unreadable) {
        return { undecidable: true, detail: `the evidence package cannot be read (${refs.reason})` };
      }
      if (refs.problems.length > 0) {
        const problem = refs.problems[0];
        return {
          undecidable: true,
          detail: `${problem.where} names \`${problem.ref}\`, which ${problem.reason}`,
        };
      }
      if (refs.targets.length === 0) {
        return { undecidable: true, detail: "the evidence package names no change" };
      }
      for (const target of refs.targets) {
        if (target.sha !== current.identity.branch_commit) {
          return {
            holds: false,
            detail: `the evidence names \`${target.sha}\`, not the current change \`${current.identity.branch_commit}\` -- the change that was reviewed is not the change being approved`,
          };
        }
      }
      return {
        holds: true,
        detail: `the evidence names \`${current.identity.branch_commit}\`, the change being approved`,
      };
    },
  },
]);

/** The implemented preconditions and what each one says. */
export function implementedPreconditions(context) {
  return PRECONDITIONS
    .filter((precondition) => precondition.status === "implemented")
    .map((precondition) => ({
      n: precondition.n,
      name: precondition.name,
      result: precondition.check(context),
    }));
}

/**
 * Run the registry.
 *
 * Every precondition is reported, implemented or not, so the report shows the
 * whole precondition surface rather than only the part that could be judged.
 */
export function runPreconditions(context) {
  const checks = [];
  for (const precondition of PRECONDITIONS) {
    if (precondition.status !== "implemented") {
      checks.push(reason("INV-01/PRECONDITION_NOT_IMPLEMENTED", {
        n: precondition.n,
        name: precondition.name,
        detail: precondition.reason,
      }));
      continue;
    }
    const result = precondition.check(context);
    if (result.undecidable) {
      checks.push(reason("INV-01/PRECONDITION_UNEVALUABLE", {
        n: precondition.n,
        detail: result.detail,
      }));
    } else if (result.holds) {
      checks.push(reason("INV-01/PRECONDITION_HOLDS", { n: precondition.n, detail: result.detail }));
    } else {
      checks.push(reason("INV-01/PRECONDITION_FAILS", { n: precondition.n, detail: result.detail }));
    }
  }
  return checks;
}
