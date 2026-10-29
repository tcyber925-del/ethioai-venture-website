// pack/tools/lib/git.mjs
//
// Read-only git, and only the four commands the validator needs.
//
// `rev-parse`      -- the current HEAD of the job branch, and the commit a
//                      `diff_ref` names.
// `status`         -- whether the working tree is clean (the merge
//                      mechanism's safety requirement).
// `merge-base`     -- whether the recorded base commit is still in the base
//                      branch's history.
// `diff`           -- whether any path is left unmerged (a conflict), and
//                      which paths changed between the recorded base and the
//                      job branch's HEAD (the protected-path gate).
//
// Every call carries `--no-optional-locks`, which stops git from refreshing
// the index behind the caller's back. A validator that claims to be
// read-only must not write to `.git/index` as a side effect of asking a
// question, and `--no-optional-locks` is the documented way to say so.
//
// No other git command is reachable from here, and none of these writes.
import { spawnSync } from "node:child_process";

const MAX_BUFFER = 8 * 1024 * 1024;

/** Run one read-only git command. Never throws; every failure is a value. */
export function git(args, { cwd, trim = true } = {}) {
  const result = spawnSync("git", ["--no-optional-locks", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  if (result.error) {
    return { ok: false, status: null, out: "", err: result.error.message };
  }
  return {
    ok: result.status === 0,
    status: result.status,
    out: trim ? (result.stdout ?? "").trim() : (result.stdout ?? ""),
    err: (result.stderr ?? "").trim(),
  };
}

/** The commit the worktree's branch currently points at. */
export function gitHead(cwd) {
  const result = git(["rev-parse", "HEAD"], { cwd });
  if (!result.ok) {
    return { ok: false, reason: result.err || `git rev-parse HEAD exited ${result.status}` };
  }
  return { ok: true, sha: result.out };
}

/**
 * Resolve a revision to a commit sha.
 *
 * `rev` may be a sha, a branch, or any other revision expression git
 * understands. A revision git cannot resolve is a failure, not a guess.
 *
 * The revision comes out of `evidence.json`, which is untrusted data, so it
 * is passed after `--end-of-options`: a ref that begins with a dash must not
 * be read as an option.
 */
export function gitRevParse(cwd, rev) {
  if (typeof rev !== "string" || rev.length === 0) {
    return { ok: false, reason: "there is no revision to resolve" };
  }
  if (rev.startsWith("-")) {
    return { ok: false, reason: "a revision may not begin with `-`" };
  }
  const result = git(["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`], { cwd });
  if (!result.ok) {
    return { ok: false, reason: result.err || `git rev-parse ${rev} exited ${result.status}` };
  }
  return { ok: true, sha: result.out };
}

/**
 * The commit a branch points at.
 *
 * This is NOT the same thing as `HEAD`, and the difference is the whole point
 * of asking separately. `HEAD` is whatever the worktree has checked out; a
 * branch is a ref, and it can point somewhere else entirely -- a worktree
 * detached at an old commit, or a branch moved from another clone. The
 * handoff pushes the BRANCH, so the branch is what the approval has to be
 * bound to.
 */
export function gitBranchTip(cwd, branch) {
  if (typeof branch !== "string" || branch.length === 0) {
    return { ok: false, reason: "there is no branch to resolve" };
  }
  if (branch.startsWith("-")) {
    return { ok: false, reason: "a branch may not begin with `-`" };
  }
  const result = git(["rev-parse", "--verify", "--end-of-options", `refs/heads/${branch}^{commit}`], { cwd });
  if (!result.ok) {
    return { ok: false, reason: result.err || `git rev-parse refs/heads/${branch} exited ${result.status}` };
  }
  return { ok: true, sha: result.out };
}

/** Is `ancestor` an ancestor of `descendant`? */
export function gitIsAncestor(cwd, ancestor, descendant) {
  const result = git(["merge-base", "--is-ancestor", ancestor, descendant], { cwd });
  if (result.status === 0) return { ok: true, ancestor: true };
  if (result.status === 1) return { ok: true, ancestor: false };
  return { ok: false, reason: result.err || `git merge-base exited ${result.status}` };
}

/** The tracked changes in the working tree. Untracked files are not listed. */
export function gitStatusPorcelain(cwd) {
  const result = git(["status", "--porcelain", "--untracked-files=no"], { cwd });
  if (!result.ok) {
    return { ok: false, reason: result.err || `git status exited ${result.status}` };
  }
  const lines = result.out.length > 0 ? result.out.split("\n") : [];
  return { ok: true, lines };
}

/** The paths git still considers unmerged -- an unresolved conflict. */
export function gitUnmergedPaths(cwd) {
  const result = git(["diff", "--name-only", "--diff-filter=U"], { cwd });
  if (!result.ok) {
    return { ok: false, reason: result.err || `git diff exited ${result.status}` };
  }
  const paths = result.out.length > 0 ? result.out.split("\n") : [];
  return { ok: true, paths };
}

/**
 * The paths that differ between two commits.
 *
 * `--no-renames` is load-bearing. With rename detection, a protected file
 * moved elsewhere is reported only by its NEW name, so a path the profile
 * protects could leave its protected directory and be rewritten outside it
 * without appearing in the list. Without rename detection, the move is the
 * deletion of the protected path plus the addition of the new one -- and the
 * deletion is a change to the protected path.
 *
 * `-z` keeps paths with newlines or quotes intact; the caller gets the names
 * exactly as git stored them, with the NUL terminators removed.
 */
export function gitDiffNames(cwd, from, to) {
  const result = git(["diff", "--name-only", "--no-renames", "-z", from, to], { cwd, trim: false });
  if (!result.ok) {
    return { ok: false, reason: result.err || `git diff exited ${result.status}` };
  }
  return { ok: true, paths: result.out.split("\0").filter((path) => path.length > 0) };
}
