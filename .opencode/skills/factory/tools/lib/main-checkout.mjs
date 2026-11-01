// pack/tools/lib/main-checkout.mjs
//
// The main checkout's guard.
//
// `reference/isolation.md`: "Never modify anything in the main checkout except
// `factory/jobs/`." The live harness checks that AFTER a run -- assertion 9,
// "nothing outside `factory/jobs/` changed" -- against a hashed listing of the
// whole tree. This module is the same check, asked BEFORE a write, so a
// mistake is caught before it does damage.
//
// The listing is a HASH of every file's content, not a list of names: a file
// whose bytes changed is a changed file, and a file that appeared is an
// appeared file. The shape is the live harness's `hashTree` exactly, so the
// two checks agree about what "changed" means.
//
// What is left out is derived, not hand-written. `.git` is always out, and
// whatever the repository itself ignores is out as well -- so `node_modules`
// and build output cost nothing, and no list of directory names has to be
// kept in step with the target repository. A checkout that is not a git
// repository has nothing to say about what it ignores, and everything but
// `.git` is listed.
//
// The baseline is the job's own. It is the listing as it stood when the job
// was first written, and it lives in the job's folder. A later write compares
// against it, so the user's own uncommitted work -- which the checkout may
// well carry, and which `isolation.md` says must never be discarded -- is in
// both listings and cancels out. Only a change made AFTER the job started is
// a violation.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { git } from "./git.mjs";

/** The one directory in the main checkout the factory may write. */
export const ALLOWED_PREFIX = "factory/jobs/";

/** The baseline file, in the job's own folder. */
export const BASELINE_NAME = "main-checkout.txt";

/**
 * A hashed listing of every working file under `dir`.
 *
 * `.git` is excluded by name: registering a worktree writes under
 * `.git/worktrees/`, and a listing that included it would report the
 * factory's own bookkeeping as a change to the user's tree.
 */
export function hashTree(dir, { exclude = [".git"], skip = [] } = {}) {
  const lines = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (exclude.includes(entry.name)) continue;
      const absolute = join(current, entry.name);
      const rel = relative(dir, absolute).split(sep).join("/");
      if (skip.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) continue;
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const digest = createHash("sha256").update(readFileSync(absolute)).digest("hex");
        lines.push(`${digest}  ${rel}`);
      }
    }
  };
  walk(dir);
  return `${lines.sort().join("\n")}\n`;
}

/**
 * What the repository itself ignores.
 *
 * Derived from git, so it cannot go stale the way a hand-written list of
 * directory names does. A directory that is not a git repository has no
 * answer, and nothing is skipped but `.git`.
 *
 * Only the DEEPEST ignored paths are kept. Git collapses a wholly ignored
 * directory into one entry, and it may also name its parents -- and skipping
 * a parent would skip its unignored siblings with it, which would hide a
 * change to a file the factory is allowed to touch and is not. Keeping the
 * deepest entry skips the ignored directory and nothing else.
 */
export function ignoredPaths(repoRoot) {
  const entries = new Set([".git"]);
  const result = git(
    ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"],
    { cwd: repoRoot },
  );
  if (result.ok) {
    for (const line of result.out.split("\n").filter((entry) => entry.length > 0)) {
      entries.add(line.replace(/\/$/, ""));
    }
  }
  const all = [...entries];
  return new Set(all.filter((entry) =>
    !all.some((other) => other !== entry && other.startsWith(`${entry}/`))));
}

/** The main checkout's content listing. */
export function mainCheckoutListing(repoRoot) {
  if (!existsSync(repoRoot)) {
    return { ok: false, reason: `the main checkout \`${repoRoot}\` does not exist` };
  }
  try {
    return { ok: true, text: hashTree(repoRoot, { exclude: [".git"], skip: [...ignoredPaths(repoRoot)] }) };
  } catch (error) {
    return { ok: false, reason: `the main checkout cannot be listed (${error.message})` };
  }
}

/** The listing as text, read back. */
export function parseListing(text) {
  const listing = new Map();
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    const at = line.indexOf("  ");
    if (at === -1) continue;
    listing.set(line.slice(at + 2), line.slice(0, at));
  }
  return listing;
}

/** What changed between two listings. */
export function listingDifferences(before, after) {
  const added = [];
  const removed = [];
  const modified = [];
  for (const [path, hash] of after) {
    if (!before.has(path)) added.push(path);
    else if (before.get(path) !== hash) modified.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) removed.push(path);
  }
  return { added, removed, modified };
}

/**
 * The guard.
 *
 * `ok: true` with `recorded: true` means there was no baseline yet: the
 * current listing BECOMES the baseline, and the caller writes it. `ok: true`
 * with `recorded: false` means the checkout still matches the baseline.
 * `ok: false` means the checkout changed outside `factory/jobs/` -- and that
 * is a refusal, not a warning.
 */
export function guardMainCheckout(jobDir, repoRoot) {
  const current = mainCheckoutListing(repoRoot);
  if (!current.ok) {
    return { ok: false, kind: "undecidable", reason: current.reason, changes: [] };
  }

  const baselinePath = join(jobDir, BASELINE_NAME);
  if (!existsSync(baselinePath)) {
    return { ok: true, recorded: true, baseline: current.text, changes: [] };
  }

  const before = parseListing(readFileSync(baselinePath, "utf8"));
  const after = parseListing(current.text);
  const differences = listingDifferences(before, after);
  const outside = [...differences.added, ...differences.removed, ...differences.modified]
    .filter((path) => !path.startsWith(ALLOWED_PREFIX));
  if (outside.length > 0) {
    // A committed change to the base branch is not the user's uncommitted work.
    // If every differing path is clean against HEAD, refresh the baseline.
    const dirty = outside.filter((path) =>
      git(["status", "--porcelain", "--", path], { cwd: repoRoot }).out !== "");
    if (dirty.length === 0) {
      return { ok: true, recorded: true, baseline: current.text, changes: outside };
    }
    return {
      ok: false,
      kind: "changed",
      changes: dirty,
      reason: `the main checkout changed outside \`${ALLOWED_PREFIX}\`: ${dirty.join(", ")}`,
    };
  }
  return { ok: true, recorded: false, changes: [] };
}
