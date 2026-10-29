// pack/tools/lib/record-store.mjs
//
// The mechanics of writing a job record, in one place.
//
// Three properties, and each one answers a way a record is lost:
//
//   1. An EXCLUSIVE LOCK. A plain `mkdir` (no `-p`) of a lock directory
//      beside the record. `mkdir` is atomic on POSIX: exactly one caller
//      creates the directory and every other caller gets `EEXIST`. This is
//      the pack's own idiom -- `reference/isolation.md` claims a worktree
//      path the same way -- and the failure is read BY ITS CAUSE: `EEXIST`
//      means another run holds the lock, `ENOENT` means the job folder is
//      not there. Reading an `ENOENT` as "another run holds this" abandons
//      every call in the batch on a diagnosis that is not true.
//
//   2. AN ATOMIC WRITE. The new record goes to a temporary file in the SAME
//      directory and is renamed over the old one. `rename` within a
//      directory is atomic on POSIX, so a reader never observes a half
//      written record and a crash leaves the previous record intact.
//
//   3. A DURABLE REFUSAL. A refusal appends a line to the job's rejection
//      log. The log is append-only: a later attempt never overwrites an
//      earlier refusal, and a reader sees every refusal in the order they
//      happened.
//
// Nothing here decides whether a transition is legal. That is the validator's
// job (`lib/invariants.mjs`); this module only makes the write safe.
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** The lock directory, beside the record it guards. */
export const LOCK_NAME = ".job.lock";

/** The rejection log, in the job's own folder. */
export const REJECTION_LOG_NAME = "rejections.log";

/** The owner file inside the lock, so a stale lock can be reported. */
const OWNER_NAME = "owner.json";

/**
 * Take the lock.
 *
 * The failure is a value, never an exception, and it says WHICH failure:
 * `locked` is another run, `missing` is a job folder that is not there, and
 * `error` is anything else. The owner file is written inside the lock, so a
 * lock nobody released can be reported to a human instead of blocking the job
 * forever.
 */
export function acquireLock(jobDir, { tool = "transition" } = {}) {
  const lockDir = join(jobDir, LOCK_NAME);
  try {
    // No `-p`: the atomicity of `mkdir` is the whole mechanism.
    mkdirSync(lockDir);
  } catch (error) {
    if (error.code === "EEXIST") {
      return {
        ok: false,
        kind: "locked",
        lockDir,
        reason: "another run holds the lock on this job's record",
        owner: readOwner(lockDir),
      };
    }
    if (error.code === "ENOENT") {
      return {
        ok: false,
        kind: "missing",
        lockDir,
        reason: "the job folder does not exist, so there is no record to lock",
      };
    }
    return {
      ok: false,
      kind: "error",
      lockDir,
      reason: `the lock could not be taken (${error.message})`,
    };
  }
  writeFileSync(join(lockDir, OWNER_NAME), `${JSON.stringify({
    tool,
    pid: process.pid,
    at: new Date().toISOString(),
  }, null, 2)}\n`);
  return { ok: true, lockDir };
}

/** Who holds a lock, when the lock is still there. */
export function readOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(join(lockDir, OWNER_NAME), "utf8"));
  } catch {
    return null;
  }
}

/** Give the lock back. Never throws: a failed release must not hide the result. */
export function releaseLock(lockDir) {
  if (!lockDir) return;
  try {
    rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // The lock stays. It is reportable, and the next run says so.
  }
}

/**
 * Run `body` with the lock held, and give the lock back on every path.
 *
 * `body` receives the lock and returns a value; a thrown error still releases
 * the lock, because a lock that outlives a crash is the one failure this
 * mechanism cannot repair on its own.
 */
export function withLock(jobDir, body, options = {}) {
  const lock = acquireLock(jobDir, options);
  if (!lock.ok) return { ok: false, ...lock };
  try {
    return { ok: true, value: body(lock) };
  } finally {
    releaseLock(lock.lockDir);
  }
}

/**
 * Write a file atomically.
 *
 * The temporary file is in the SAME directory as the target, because `rename`
 * is only atomic within a directory: a temporary file elsewhere would be
 * copied, and a copy is not atomic.
 */
export function writeAtomic(path, text) {
  const directory = dirname(path);
  const temporary = join(directory, `.${basename(path)}.tmp-${process.pid}-${counter()}`);
  try {
    // The mode of the file being replaced, so a record written with a
    // restrictive mode does not silently become world-readable.
    let mode = 0o644;
    try {
      mode = statSync(path).mode & 0o777;
    } catch {
      // No file yet: the default is the right one.
    }
    writeFileSync(temporary, text, { mode });
    // Flush the content before the rename. A rename is atomic, but an
    // atomic rename of content that is still in the page cache is a way to
    // lose the record on a power event -- which is the one moment the
    // "durable" claim is about.
    const handle = openSync(temporary, "r");
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(temporary, path);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // The temporary file is left behind; the record itself is untouched.
    }
    throw error;
  }
}

let sequence = 0;
/** A per-process counter, so two writes in one process never collide. */
function counter() {
  sequence += 1;
  return sequence;
}

/** The record, read. Never throws: a failure is a value. */
export function readRecord(jobDir) {
  const path = join(jobDir, "job.json");
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const missing = error.code === "ENOENT";
    return {
      ok: false,
      kind: missing ? "missing" : "unreadable",
      reason: missing ? "the record does not exist" : error.message,
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, kind: "unparseable", reason: error.message };
  }
}

/**
 * Secrets never reach the log.
 *
 * A rejection log is a file a human reads, and a file a human shares. The
 * details it carries come from the validator's reasons, which quote what is
 * on disk -- so anything shaped like a token is masked before it is written.
 */
const SECRET_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // A PEM block is a private key whatever follows the marker.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  // The modern project-scoped key shape: `sk-proj-...` is not the same
  // string as the plain `sk-...` the older pattern caught.
  /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g,
  // AWS's secret access key, which is not the access key ID.
  /\baws_secret_access_key["']?\s*[=:]\s*("?)[^\s"',;]+/gi,
  // A credential in a URL's userinfo: `https://user:token@host`.
  /(https?:\/\/)[^\s\/:@]+:[^\s\/@]+@/g,
  /((?:token|secret|password|passwd|api[_-]?key|credential|authorization)["']?\s*[=:]\s*)("?)[^\s"',;]+/gi,
];

/** Mask anything that looks like a secret. */
export function redact(text) {
  let out = String(text ?? "");
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix) =>
      (typeof prefix === "string" ? `${prefix}[redacted]` : "[redacted]"));
  }
  return out;
}

/**
 * Append one refusal to the job's rejection log.
 *
 * The log is JSON Lines: one object per line, in the order the refusals
 * happened, so it reads both by eye and by machine. It is append-only --
 * `appendFileSync` adds to the end and never rewrites what is there -- and a
 * later attempt can never overwrite an earlier refusal.
 */
export function appendRejection(jobDir, entry) {
  const line = `${JSON.stringify({
    at: entry.at ?? new Date().toISOString(),
    job: entry.job ?? null,
    tool: entry.tool ?? null,
    attempted: entry.attempted ?? null,
    stage: entry.stage ?? null,
    failed: entry.failed ?? null,
    conclusion: entry.conclusion ?? null,
    detail: redact(entry.detail ?? ""),
  })}\n`;
  try {
    const path = join(jobDir, REJECTION_LOG_NAME);
    const handle = openSync(path, "a");
    try {
      appendFileSync(handle, line);
      // "Durable" is a claim about the disk, not about the page cache: a
      // refusal that is lost in a crash is a refusal nobody can investigate.
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

/** The rejection log, read back. Never throws. */
export function readRejections(jobDir) {
  const path = join(jobDir, REJECTION_LOG_NAME);
  if (!existsSync(path)) return [];
  const entries = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      entries.push({ at: null, job: null, tool: null, attempted: null, stage: null,
        failed: "UNPARSEABLE", conclusion: "unreadable", detail: line.trim() });
    }
  }
  return entries;
}
