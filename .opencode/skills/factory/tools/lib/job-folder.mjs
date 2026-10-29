// pack/tools/lib/job-folder.mjs
//
// The job folder, read.
//
// Everything the validator inspects lives in one job folder:
// `job.json` (the record), `evidence.json` (the verification package),
// `spec.md`, `build.md`, `decision.md` and `round-<N>/review-*.md`.
//
// Nothing here writes. A read that fails is a VALUE, never an exception: the
// validator's job is to report "the validator could not decide", and an
// exception would say "the validator crashed" instead -- a different, and
// less useful, thing to tell a human.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

/** The four reviewers, and the agent each one runs as. */
export const ROLES = Object.freeze(["code", "security", "scope", "visual"]);

/** The agent that writes the verdict file for a role. */
export const reviewerAgent = (role) => `reviewer-${role}`;

/**
 * The repository root a job's relative worktree path is resolved against.
 *
 * A job folder is `<repo>/factory/jobs/<job-id>`, so the root is the part
 * before `factory/jobs`. A folder that does not sit there has no such root,
 * and the folder itself is used -- an absolute `worktree` path resolves the
 * same way either way.
 */
export function repoRootFor(folder) {
  const parts = folder.split(sep);
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    if (parts[i] === "jobs" && parts[i - 1] === "factory") {
      return parts.slice(0, i - 1).join(sep) || sep;
    }
  }
  return folder;
}

/** Read a file as text. Never throws. */
export function readText(path) {
  try {
    return { ok: true, text: readFileSync(path, "utf8") };
  } catch (error) {
    const missing = error.code === "ENOENT";
    return {
      ok: false,
      kind: missing ? "missing" : "unreadable",
      reason: missing ? "it does not exist" : error.message,
    };
  }
}

/** Read a file as JSON. Never throws. */
export function readJson(path) {
  const text = readText(path);
  if (!text.ok) return { ok: false, kind: text.kind, reason: text.reason };
  try {
    return { ok: true, value: JSON.parse(text.text) };
  } catch (error) {
    return { ok: false, kind: "unparseable", reason: error.message };
  }
}

/**
 * The verdict in a verdict file.
 *
 * `review.md` gives the grammar: the first line is the verdict, matched
 * exactly, and only `blocking` findings produce `CHANGES`. A file whose first
 * line is not a legal verdict is malformed -- never defaulted. A
 * `NOT_APPLICABLE` with no stated reason is malformed too: `review.md` says it
 * "stops the orchestrator just like a missing file".
 */
export function parseVerdictFile(text) {
  const first = text.split("\n", 1)[0].trim();
  const verdict = /^VERDICT:\s*(PASS|CHANGES|NOT_APPLICABLE)\s*$/.exec(first)?.[1] ?? null;
  // The finding heading is matched case-insensitively: the grammar fixes it
  // as `### blocking`, but a reviewer that drifts to `### Blocking` has still
  // written a finding, and treating it as prose would let a blocking finding
  // pass as a note.
  const findings = [...text.matchAll(/^\#{2,4}\s*blocking\b[^\n]*$/gim)];
  const citations = [...text.matchAll(/^\#{2,4}\s*blocking\s+(?:—|-)\s+(\S+:\d+)/gim)];
  // "A stated reason" is read the way `review.md` reads it: the file records
  // something beyond the verdict and the scope. A heading is structure, and
  // the `Scope:` line says WHAT was looked at, not WHY it did not apply --
  // neither is a reason. Magic words were tried first and rejected: they
  // refused a perfectly good "No UI files were touched in this change".
  const stated = text.split("\n").slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^#{1,6}\s/.test(line))
    .filter((line) => !/^scope\s*:/i.test(line));
  const statesReason = stated.length > 0;
  return {
    first,
    verdict,
    malformed: verdict === null,
    missingReason: verdict === "NOT_APPLICABLE" && !statesReason,
    blocking: findings.length > 0,
    blockingCitations: citations.map((match) => match[1]),
  };
}

/**
 * Open a job folder.
 *
 * The returned object is the validator's whole view of the job. Every read is
 * lazy and every failure is a value.
 */
export function openJob(folder) {
  const root = resolve(folder);
  const repoRoot = repoRootFor(root);

  const text = (rel) => readText(resolve(root, rel));
  const json = (rel) => readJson(resolve(root, rel));

  const recordFile = json("job.json");
  const record = recordFile.ok ? recordFile.value : null;
  const recordError = recordFile.ok
    ? null
    : { kind: recordFile.kind, reason: recordFile.reason, path: resolve(root, "job.json") };

  const round = Number.isInteger(record?.round) ? record.round : null;

  return {
    folder: root,
    repoRoot,
    record,
    recordError,
    round,

    /** The record's `reviews` object, or null. */
    reviews() {
      const reviews = record?.reviews;
      return reviews && typeof reviews === "object" && !Array.isArray(reviews) ? reviews : null;
    },

    /** The claim for one role, or null when there is none. */
    claim(role) {
      const value = this.reviews()?.[role];
      return typeof value === "string" ? value : null;
    },

    /** The path of a role's verdict file in the current round. */
    verdictFile(role) {
      return round === null ? null : `round-${round}/review-${role}.md`;
    },

    /** A verdict file, parsed. `null` when the round is unknown. */
    verdict(role) {
      const file = this.verdictFile(role);
      if (file === null) return null;
      const read = text(file);
      if (!read.ok) return { file, ok: false, kind: read.kind, reason: read.reason };
      return { file, ok: true, ...parseVerdictFile(read.text) };
    },

    /** The evidence package. */
    evidence() {
      return json("evidence.json");
    },

    /** The recorded invocations. */
    invocations() {
      const list = record?.runtime?.invocations;
      return Array.isArray(list) ? list : [];
    },

    /** The job's worktree, absolute. */
    worktree() {
      const worktree = record?.worktree;
      if (typeof worktree !== "string" || worktree.length === 0) return null;
      return resolve(repoRoot, worktree);
    },

    /** Does a path exist in the job folder? */
    has(rel) {
      return existsSync(resolve(root, rel));
    },

    text,
    json,
  };
}
