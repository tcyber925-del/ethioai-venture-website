// pack/tools/lib/change-identity.mjs
//
// The change identity: WHICH change is being approved.
//
// An approval that names a commit is not bound to a change -- a commit sha is
// a hash of the change's CONTENT, so it names the content, but nothing says
// the worktree still holds that content, that the base it was cut from is
// still the base, or that the evidence was gathered about it. The identity is
// the pair plus the two live facts that make the pair mean what it says:
//
//   base_commit  the commit the job branch was cut from (record.base_commit)
//   head_commit  the commit the job worktree's HEAD points at now
//   clean        the tracked working tree carries no uncommitted changes
//   base_intact  the base commit is still in the base branch's history
//
// It is deterministic (read-only git, no clock, no network, no randomness),
// content-addressed (head_commit is a hash of the change), and complete enough
// to catch the four staleness cases:
//
//   1. the job branch moved       -> head_commit changes
//   2. uncommitted changes        -> clean flips to false (the sha does not move)
//   3. the base was rewritten      -> base_intact flips to false
//   4. the evidence names another change -> INV-04 / precondition 6
//
// The identity is a VALUE. Every failure is a value too: a missing worktree, a
// record with no base commit, a directory that is not a git repository -- each
// is "the tool could not decide", never a permit.
import { existsSync } from "node:fs";
import { gitBranchTip, gitHead, gitIsAncestor, gitRevParse, gitStatusPorcelain } from "./git.mjs";
import { parseRef } from "./refs.mjs";

/**
 * The job's worktree, when it can be reached.
 *
 * A record that names no worktree, a worktree that does not exist, and a
 * directory that is not a git repository are three ways of not having one, and
 * all three are undecidable rather than failures.
 */
export function worktreeOf(context) {
  const path = context.worktree();
  if (!path) return { ok: false, reason: "the record names no worktree" };
  if (!existsSync(path)) return { ok: false, reason: `the worktree \`${path}\` does not exist` };
  const head = gitHead(path);
  if (!head.ok) return { ok: false, reason: `the worktree is not a git worktree (${head.reason})` };
  return { ok: true, path };
}

/**
 * The change identity, computed from the repository right now.
 *
 * `ok: false` means the identity could not be computed -- the inputs are
 * missing or unreadable -- and every caller must treat that as undecidable.
 */
export function changeIdentity(context) {
  const worktree = worktreeOf(context);
  if (!worktree.ok) return { ok: false, reason: worktree.reason };

  const baseCommit = context.record?.base_commit;
  if (typeof baseCommit !== "string" || baseCommit.trim().length === 0) {
    return { ok: false, reason: "the record names no base commit" };
  }
  const baseBranch = context.record?.base_branch;
  if (typeof baseBranch !== "string" || baseBranch.trim().length === 0) {
    return { ok: false, reason: "the record names no base branch" };
  }

  const head = gitHead(worktree.path);
  if (!head.ok) return { ok: false, reason: `the worktree's HEAD cannot be read (${head.reason})` };

  // The commit the handoff would PUSH is the branch's tip, not the
  // worktree's HEAD. They are usually the same -- the builder commits on the
  // job branch -- but they need not be: a worktree detached at an old commit,
  // or a branch moved from another clone, leaves HEAD on one commit and the
  // branch on another. Binding an approval to HEAD and then pushing the
  // branch would approve one change and ship another, so the branch is what
  // the identity names, and HEAD is recorded beside it.
  const branchTip = gitBranchTip(worktree.path, context.record?.branch);
  if (!branchTip.ok) {
    return { ok: false, reason: `the job branch cannot be resolved (${branchTip.reason})` };
  }

  const base = gitRevParse(worktree.path, baseCommit);
  if (!base.ok) {
    return { ok: false, reason: `the recorded base commit \`${baseCommit}\` cannot be resolved (${base.reason})` };
  }
  const branch = gitRevParse(worktree.path, baseBranch);
  if (!branch.ok) {
    return { ok: false, reason: `the base branch \`${baseBranch}\` cannot be resolved (${branch.reason})` };
  }
  const status = gitStatusPorcelain(worktree.path);
  if (!status.ok) return { ok: false, reason: status.reason };
  const ancestor = gitIsAncestor(worktree.path, base.sha, branch.sha);
  if (!ancestor.ok) return { ok: false, reason: ancestor.reason };

  return {
    ok: true,
    worktree: worktree.path,
    identity: {
      base_commit: base.sha,
      head_commit: head.sha,
      branch_commit: branchTip.sha,
      on_branch: head.sha === branchTip.sha,
      clean: status.lines.length === 0,
      base_intact: ancestor.ancestor,
    },
  };
}

/** The identity, as one line a human can read. */
export function describeIdentity(identity) {
  return `base \`${identity.base_commit}\`, head \`${identity.head_commit}\`, ` +
    `branch \`${identity.branch_commit}\`, ` +
    `worktree ${identity.clean ? "clean" : "dirty"}, ` +
    `${identity.on_branch ? "on the job branch" : "NOT on the job branch"}, base ` +
    `${identity.base_intact ? "intact" : "rewritten"}`;
}

/**
 * The worktree safety facts every later gate depends on: the tracked tree is
 * clean, and HEAD is the job branch's own commit.
 *
 * The approval preconditions check both before a push; the transition into
 * `verifying` checks them earlier, so a review round is never spent on a tree
 * that cannot be handed over. One definition serves both, so the early gate
 * cannot disagree with the later one.
 *
 * `undecidable` means the worktree cannot be read -- missing, not a git
 * worktree, or a git command that failed. An unanswered safety question is
 * never a permit.
 */
export function worktreeSafety(context) {
  const worktree = worktreeOf(context);
  if (!worktree.ok) return { undecidable: true, detail: worktree.reason };

  const status = gitStatusPorcelain(worktree.path);
  if (!status.ok) return { undecidable: true, detail: status.reason };
  if (status.lines.length > 0) {
    return {
      holds: false,
      detail: `the working tree carries uncommitted changes: ${status.lines.join("; ")}`,
    };
  }

  const head = gitHead(worktree.path);
  if (!head.ok) return { undecidable: true, detail: head.reason };
  const branch = gitBranchTip(worktree.path, context.record?.branch);
  if (!branch.ok) return { undecidable: true, detail: branch.reason };
  if (head.sha !== branch.sha) {
    return {
      holds: false,
      detail: `the worktree is at \`${head.sha}\` but the job branch holds \`${branch.sha}\` -- the worktree is not on the branch that will be handed over`,
    };
  }
  return {
    holds: true,
    detail: "the tracked working tree is clean, and it is the job branch's own commit",
  };
}

/**
 * Is the approval still bound to the current change?
 *
 * The approval names a binding: the base commit it was granted against and
 * the commit it approved. This compares that binding with the identity
 * computed right now, and says which of the two differs.
 *
 * A binding that cannot be resolved is undecidable, not a failure: a ref that
 * names no commit this worktree knows is a question the tool could not answer.
 */
export function checkBinding(context, { approval, identity } = {}) {
  const current = identity ?? changeIdentity(context);
  if (!current.ok) return { undecidable: true, detail: current.reason };

  // The binding must name IMMUTABLE content. A branch name is not a change:
  // it is a label that keeps pointing at whatever comes next, so an approval
  // bound to one never goes stale -- it authorises whatever the branch
  // happens to hold when the guard looks. A sha is a hash of the content it
  // names, and cannot move.
  const shape = parseRef(approval.diff_ref);
  if (shape.shape !== "sha") {
    return {
      holds: false,
      detail: `the approval's diff_ref \`${approval.diff_ref}\` is not a commit sha -- a binding must name immutable content, and \`${shape.shape}\` can move under it`,
    };
  }

  const approved = gitRevParse(current.worktree, approval.diff_ref);
  if (!approved.ok) {
    return {
      undecidable: true,
      detail: `the approved diff_ref \`${approval.diff_ref}\` cannot be resolved (${approved.reason})`,
    };
  }
  if (approved.sha !== current.identity.branch_commit) {
    return {
      holds: false,
      detail: `the approval is bound to \`${approved.sha}\` but the job branch now holds \`${current.identity.branch_commit}\` -- the approval is stale`,
    };
  }

  const recordedBase = approval.base_commit;
  if (typeof recordedBase !== "string" || recordedBase.trim().length === 0) {
    return { holds: false, detail: "the approval records no base commit" };
  }
  const base = gitRevParse(current.worktree, recordedBase);
  if (!base.ok) {
    return {
      undecidable: true,
      detail: `the approval's base commit \`${recordedBase}\` cannot be resolved (${base.reason})`,
    };
  }
  if (base.sha !== current.identity.base_commit) {
    return {
      holds: false,
      detail: `the approval was granted against base \`${base.sha}\`, not the recorded base \`${current.identity.base_commit}\``,
    };
  }
  if (!current.identity.clean) {
    return {
      holds: false,
      detail: "the working tree carries uncommitted changes, so the current change is not the approved one",
    };
  }
  if (!current.identity.base_intact) {
    return {
      holds: false,
      detail: `the base branch no longer contains \`${current.identity.base_commit}\` -- the base was rewritten`,
    };
  }
  return {
    holds: true,
    detail: `the approval is bound to the current change (${describeIdentity(current.identity)})`,
  };
}
