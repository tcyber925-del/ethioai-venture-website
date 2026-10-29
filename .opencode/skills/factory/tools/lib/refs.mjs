// pack/tools/lib/refs.mjs
//
// What a `diff_ref` names.
//
// Two shapes exist in this pack and the pack never reconciles them: a range
// `A..B` (the design spec's own example, `"39e1684..factory/001-about-faq"`)
// and a single commit sha. Anything else has no canonical shape, and a ref
// whose shape the pack does not define is never a permit.
//
// Every ref is resolved through git, so the short sha the pack's own example
// uses is the same commit as the full sha git hands back, and a `B` that is a
// branch name resolves to the commit it points at.
//
// This module is the ONE place a ref is parsed and resolved. The validator's
// INV-04 and §14.2 precondition 6 both ask the same question -- which change
// does this ref name? -- and two copies of the answer would drift.
import { gitRevParse } from "./git.mjs";

/**
 * The shape of a `diff_ref`.
 *
 * A range `A..B` names the change by its right-hand side, `B`; a single sha
 * names it by itself.
 */
export function parseRef(ref) {
  if (typeof ref !== "string") return { shape: "unknown" };
  const text = ref.trim();
  if (text.length === 0) return { shape: "unknown" };
  const at = text.indexOf("..");
  if (at > 0) {
    const left = text.slice(0, at).trim();
    const right = text.slice(at + 2).trim();
    if (left.length === 0 || right.length === 0 || right.includes("..")) return { shape: "unknown" };
    return { shape: "range", left, target: right };
  }
  if (/^[0-9a-f]{7,40}$/.test(text)) return { shape: "sha", target: text };
  return { shape: "unknown" };
}

/**
 * The commit a ref names.
 *
 * A ref git cannot resolve names no commit this worktree knows, which is a
 * different answer from "a different commit".
 */
export function resolveTarget(target, worktree) {
  if (!worktree.ok) return { ok: false, reason: worktree.reason };
  const resolved = gitRevParse(worktree.path, target);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  return { ok: true, sha: resolved.sha };
}

/**
 * Every `diff_ref` the evidence package carries, and the commit each names.
 *
 * The package's own `diff_ref` and each check's `diff_ref` are all read: the
 * package names the change it verified, and each check names the change it ran
 * against. A ref that cannot be parsed, or that git cannot resolve, is a
 * `problem` rather than a target -- it is a question the tool could not
 * answer, and it is never a silent agreement.
 *
 * `missing` and `unreadable` say the package itself could not be read. The
 * worktree is passed in, because resolving a ref means asking git about a
 * commit, and a worktree that cannot be reached makes every ref unresolvable.
 */
export function evidenceRefs(context, worktree) {
  const evidence = context.evidence();
  if (!evidence.ok) {
    return {
      missing: evidence.kind === "missing",
      unreadable: evidence.kind !== "missing",
      reason: evidence.reason,
      targets: [],
      problems: [],
    };
  }

  const packageRef = evidence.value?.diff_ref;
  const packageChecks = Array.isArray(evidence.value?.checks) ? evidence.value.checks : [];
  const refs = [
    { where: "the package's `diff_ref`", ref: packageRef },
    ...packageChecks.map((check, index) => ({
      where: `the check \`${check?.check ?? index}\``,
      ref: check?.diff_ref,
    })),
  ];

  const targets = [];  const problems = [];
  for (const entry of refs) {
    const parsed = parseRef(entry.ref);
    if (parsed.shape === "unknown") {
      problems.push({
        kind: "shape",
        where: entry.where,
        ref: typeof entry.ref === "string" ? entry.ref : String(entry.ref),
        reason: "it is neither a range `A..B` nor a single commit sha",
      });
      continue;
    }
    const resolved = resolveTarget(parsed.target, worktree);
    if (!resolved.ok) {
      problems.push({
        kind: "unresolvable",
        where: entry.where,
        ref: typeof entry.ref === "string" ? entry.ref : String(entry.ref),
        reason: resolved.reason,
      });
      continue;
    }
    targets.push({ where: entry.where, ref: entry.ref, sha: resolved.sha });
  }
  return { missing: false, unreadable: false, reason: null, targets, problems };
}
