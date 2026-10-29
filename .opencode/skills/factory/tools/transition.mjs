#!/usr/bin/env node
// pack/tools/transition.mjs
//
// The guarded transition writer: the ONE writer of `job.json`.
//
// The orchestrator used to edit the record by hand, which left three holes
// the pack's own documents already said were holes:
//
//   - two writers of one record overwrote each other, silently;
//   - a write interrupted half way left a truncated record;
//   - "in the same write to `job.json`" was prose to a model, and nothing
//     checked that the retry budget and the round moved together.
//
// This tool closes them. It is the only thing that writes the record, it
// refuses a transition the validator does not permit, it writes under an
// exclusive lock and renames the new record into place atomically, and every
// refusal it makes is left in the job's own rejection log.
//
// The trigger is judged against the record the write WOULD leave behind, not
// the one on disk: a rule like "the record says the spec was approved" is
// about a field the same write sets, and judged against the old record it
// could never be satisfied. The budget is read the other way round — "is
// there a retry left" asks about the budget as it stood BEFORE this write
// spends it.
//
//   node tools/transition.mjs --job <job-folder> --to <stage> [--expect-stage <stage>]
//                             [--set <path>=<value>]... [--append <path>=<value>]...
//                             [--cause <text>] [--json]
//   node tools/transition.mjs --job <job-folder> --create --record <json> [--set <path>=<value>]... [--json]
//
// Exit codes are the contract:
//
//   0  the record was written
//   1  refused: the transition was not made, and the reason names it
//   2  inconclusive: an input could not be read, so nothing could be decided
//   3  usage error
//
// A non-zero exit is never a pass, and it never advances the job: a refusal
// leaves the record exactly as it was.
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./schema-validator.mjs";
import { schemaPath } from "./lib/pack-paths.mjs";
import { validateJob } from "./validate.mjs";
import { repoRootFor, ROLES, parseVerdictFile, readText } from "./lib/job-folder.mjs";
import { policyBinding, samePolicy } from "./lib/profile.mjs";
import { PERMIT } from "./lib/reasons.mjs";
import { appendRejection, readRecord, redact, releaseLock, acquireLock, writeAtomic } from "./lib/record-store.mjs";
import { BASELINE_NAME, guardMainCheckout } from "./lib/main-checkout.mjs";

const USAGE = `usage:
  node tools/transition.mjs --job <job-folder> --to <stage> [--expect-stage <stage>]
                            [--set <path>=<value>]... [--append <path>=<value>]...
                            [--cause <text>] [--json]
  node tools/transition.mjs --job <job-folder> --set-fields
                            [--set <path>=<value>]... [--append <path>=<value>]...
                            [--cause <text>] [--json]
  node tools/transition.mjs --job <job-folder> --sync [--expect-stage <stage>] [--json]
  node tools/transition.mjs --job <job-folder> --create --record <json> [--set <path>=<value>]... [--json]

exit codes:
  0  the record was written
  1  refused: the transition was not made
  2  inconclusive: an input could not be read
  3  usage error

--to names the stage the job moves to. The transition must be a row of
reference/state-machine.md and its own trigger must hold, or the write is
refused.

--create writes the first record. It must be at stage "queued", and it may
not carry a policy field: the claim (queued -> planning) binds the profile's
effective protected_paths (including ".factory/profile.md" and
".factory/policies/**"), so a record created at a later stage could never be
bound.
--set may fill ordinary fields on creation, but not the record's identity or
its policy.

--set-fields records fields WITHOUT moving the job. Some of the record is
field-recording and nothing else: the four review verdicts, the approval,
the spec approval, a spawned session id, the restored retry budget. None of
those is a stage change, and none of them has a row in the transition table
-- a stage that moved to itself is not a transition, and the table does not
say it is. This mode writes them, leaves the stage alone, and refuses
anything that would move it. --expect-stage names the stage the job was believed to be at; a
record that has moved since is stale and is refused too.

--sync records the four review verdicts from the files that carry them:
round-<N>/review-{code,security,scope,visual}.md, where N is the record's
round. A file that exists is read exactly as it is; a malformed verdict, or a
NOT_APPLICABLE with no stated reason, refuses the whole sync and writes
nothing. A role with no file is left alone -- a partial wave must not overwrite
a returned verdict with pending. The stage never moves, and the write takes the
same lock and atomic rename as every other write.

--set <path>=<value> writes one field. The value is JSON when it parses and a
plain string otherwise; quote a numeric string ("\\"404\\"") to keep it a
string. --append <path>=<value> appends a JSON value to an array field, which
is how a spawned session id is recorded at launch.

--cause writes the cause of a park. A job at needs_human or blocked must
carry one; a park with no stated reason is not recoverable.

The tool is the only writer of job.json. It writes under an exclusive lock,
renames the new record into place atomically, and leaves a durable record of
every refusal in the job's own rejection log.`;

/** The stages whose records must carry a cause. */
const PARKED_STAGES = ["needs_human", "blocked"];

/**
 * The fields a write may not touch.
 *
 * `handoff` is the one that matters: only the guarded tool knows whether a
 * push happened and a pull request was opened, and the `handed_off` row
 * trusts the record's own account of it. Everything else here identifies the
 * job, and a write that could change them would be a second way to be
 * something other than the job the record is about.
 */
const FORBIDDEN = ["handoff", "stage", "id", "source", "feature", "repo", "worktree", "branch", "policy"];

/**
 * The forbidden fields a set of `--set` / `--append` entries names.
 *
 * The ROOT of the path, not the whole path. An earlier version compared the
 * whole path, and `--set handoff.pushed=true` walked straight past a list
 * that said `handoff` -- so a record could be given a handoff that never
 * happened, and a job could reach `handed_off` without the guarded tool ever
 * running. The root is what a field IS: `handoff.pushed` sets a field OF
 * `handoff`, and the whole of `handoff` is the guarded tool's.
 */
function forbiddenRoots(entries) {
  const roots = new Set();
  for (const entry of entries) {
    const at = entry.indexOf("=");
    const path = at === -1 ? entry : entry.slice(0, at);
    const root = path.split(".")[0];
    if (FORBIDDEN.includes(root)) roots.add(root);
  }
  return [...roots];
}

let jobSchema = null;
/** The job schema, read once. */
function schema() {
  if (!jobSchema) jobSchema = JSON.parse(readFileSync(schemaPath("job.schema.json"), "utf8"));
  return jobSchema;
}

/** The exit code an outcome maps to. */
const exitCodeFor = (outcome) => {
  if (outcome === "ok") return 0;
  if (outcome === "refused") return 1;
  if (outcome === "inconclusive") return 2;
  return 3;
};

/** Parse the command line. An unknown flag is a usage error, not a default. */
export function parseArgs(argv) {
  const options = {
    job: null, to: null, expectStage: null, create: false, record: null,
    setFields: false, sync: false, sets: [], appends: [], cause: null, json: false, help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--job":
        options.job = argv[++index] ?? null;
        break;
      case "--to":
        options.to = argv[++index] ?? null;
        break;
      case "--expect-stage":
        options.expectStage = argv[++index] ?? null;
        break;
      case "--create":
        options.create = true;
        break;
      case "--set-fields":
        options.setFields = true;
        break;
      case "--sync":
        options.sync = true;
        break;
      case "--record":
        options.record = argv[++index] ?? null;
        break;
      case "--set":
        options.sets.push(argv[++index] ?? "");
        break;
      case "--append":
        options.appends.push(argv[++index] ?? "");
        break;
      case "--cause":
        options.cause = argv[++index] ?? null;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        return { error: `unknown argument: ${flag}` };
    }
  }
  return { options };
}

/** Check the options against each other. */
export function checkUsage(options) {
  if (options.help) return null;
  if (!options.job) return "--job <job-folder> is required";
  if (options.create && options.to) return "--create and --to cannot be combined";
  if (options.create && options.setFields) return "--create and --set-fields cannot be combined";
  if (options.create && options.sync) return "--create and --sync cannot be combined";
  if (options.setFields && options.to) return "--set-fields does not move the job, so it takes no --to";
  if (options.sync && options.to) return "--sync does not move the job, so it takes no --to";
  if (options.sync && options.setFields) return "--sync and --set-fields are two write modes; choose one";
  if (options.sync && (options.sets.length > 0 || options.appends.length > 0 || options.cause !== null)) {
    return "--sync reads the verdict files; it takes no --set, --append or --cause";
  }
  if (options.setFields && !options.create && options.record) return "--record belongs to --create";
  if (!options.create && !options.setFields && !options.sync && !options.to) {
    return "one of --to <stage>, --set-fields, --sync or --create is required";
  }
  if (options.create && !options.record) return "--create requires --record <json>";
  if (!options.create && options.record) return "--record belongs to --create";
  for (const entry of [...options.sets, ...options.appends]) {
    if (!entry.includes("=")) return `a --set or --append needs <path>=<value>, got \`${entry}\``;
  }
  return null;
}

/**
 * The value of a `--set` or `--append`.
 *
 * JSON when it parses, a plain string otherwise. A numeric string is written
 * as a number, so a string that must stay a string is quoted: `--set
 * cause='"404"'`.
 */
export function parseValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Write one field of the record, by dotted path. */
export function applyField(record, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  let target = record;
  for (const part of parts) {
    if (typeof target[part] !== "object" || target[part] === null) target[part] = {};
    target = target[part];
  }
  target[last] = value;
  return record;
}

/** Append one value to an array field, by dotted path. */
export function applyAppend(record, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  let target = record;
  for (const part of parts) {
    if (typeof target[part] !== "object" || target[part] === null) target[part] = {};
    target = target[part];
  }
  const current = target[last];
  target[last] = Array.isArray(current) ? [...current, value] : [value];
  return record;
}

/**
 * The one write of `job.json`.
 *
 * Locked, atomic, and schema-checked: the new record is validated against
 * `schemas/job.schema.json` BEFORE it is renamed into place, so a record that
 * does not validate never reaches the disk. The lock is given back on every
 * path, including a failure and a throw.
 *
 * `mutate` receives the record as it was read and returns `{ok: true,
 * record}` or a refusal `{ok: false, kind, failed, reason}`.
 */
export function writeRecord(folder, mutate, { lock = null } = {}) {
  // A caller that already holds the lock passes it in, and the write joins
  // that lock instead of taking a second one. The guarded handoff needs it:
  // its verify, its push and its record must be one exclusive run, or two
  // of them could both pass the verification and both push.
  const held = lock ?? acquireLock(folder, { tool: "transition" });
  if (!held.ok) {
    return { ok: false, kind: held.kind, failed: "LOCKED", reason: held.reason, owner: held.owner ?? null };
  }
  const own = lock === null;
  try {
    const read = readRecord(folder);
    if (!read.ok) {
      return { ok: false, kind: read.kind, failed: "RECORD_UNREADABLE",
        reason: `the record cannot be read (${read.reason})` };
    }
    const outcome = mutate(read.value);
    if (!outcome.ok) return outcome;
    const errors = validate(schema(), outcome.record);
    if (errors.length > 0) {
      return { ok: false, kind: "invalid", failed: "RECORD_INVALID",
        reason: `the record does not validate against \`schemas/job.schema.json\`: ${errors.join("; ")}` };
    }
    writeAtomic(join(folder, "job.json"), `${JSON.stringify(outcome.record, null, 2)}\n`);
    return { ok: true, record: outcome.record };
  } catch (error) {
    return { ok: false, kind: "error", failed: "WRITE_FAILED",
      reason: `the record could not be written (${error.message})` };
  } finally {
    if (own) releaseLock(held.lockDir);
  }
}

/**
 * The main checkout's guard, as a refusal.
 *
 * The baseline is the listing as it stood when the job was written; it is
 * recorded the first time the guard runs, and compared on every later write.
 */
function checkWorkspace(folder, record) {
  const repoRoot = repoRootFor(folder);
  const guard = guardMainCheckout(folder, repoRoot);
  if (!guard.ok) {
    return {
      ok: false,
      kind: guard.kind === "undecidable" ? "undecidable" : "workspace",
      failed: "MAIN_CHECKOUT_CHANGED",
      reason: guard.reason,
    };
  }
  if (guard.recorded) {
    writeAtomic(join(folder, BASELINE_NAME), guard.baseline);
  }
  return { ok: true };
}

/**
 * Advance a job.
 *
 * The transition is checked against the record as it was read, under the
 * lock, so two callers cannot interleave: one of them holds the lock and the
 * other is told the record is locked.
 */
export function advanceJob(folder, { to, expectStage = null, sets = [], appends = [], cause = null }) {
  let from = null;
  // The same rule as a field write, and for the same reason: a write that
  // carries `--to` can set the fields too, and a forged `handoff` in the
  // same call would be a forged handoff. The refusal is the same one.
  const offending = forbiddenRoots([...sets, ...appends]);
  if (offending.length > 0) {
    return {
      ok: false,
      kind: "illegal",
      failed: "FIELD_NOT_WRITABLE",
      reason: `a write may not set \`${offending.join("`, `")}\` -- \`handoff\` belongs to the guarded tool alone, and the rest identify the job`,
    };
  }
  const outcome = writeRecord(folder, (record) => {
    from = record.stage;

    // The record must still be the one the caller decided about.
    if (expectStage && from !== expectStage) {
      return {
        ok: false,
        kind: "stale",
        failed: "STALE_RECORD",
        reason: `the record is at \`${from}\`, not the \`${expectStage}\` this call was made for`,
      };
    }

    // The record this write WOULD leave behind. The fields come first,
    // because a trigger can be about a field: `/factory go` sets
    // `spec_approved` and moves the job in one call, and the rule that
    // permits `awaiting_plan_approval -> building` is "the record says the
    // spec was approved". Judged against the record on disk, that field
    // could never be there yet, and the approval tier could never leave the
    // planning stage. `stage` is deliberately NOT moved here: the record
    // being judged is still at the stage it is leaving.
    const prospective = structuredClone(record);
    for (const entry of sets) {
      const at = entry.indexOf("=");
      applyField(prospective, entry.slice(0, at), parseValue(entry.slice(at + 1)));
    }
    for (const entry of appends) {
      const at = entry.indexOf("=");
      applyAppend(prospective, entry.slice(0, at), parseValue(entry.slice(at + 1)));
    }
    if (cause !== null) prospective.cause = cause;

    // The claim: `queued -> planning` is the dispatch's own write of that
    // stage, and it is also where the job binds the effective policy,
    // including the implicit protection of the policy files themselves. The
    // binding is computed by this tool, not written from the caller's input,
    // so no record a caller could forge can arrive with its own policy.
    if (from === "queued" && to === "planning") {
      const binding = policyBinding(repoRootFor(folder));
      if (!binding.ok) {
        return {
          ok: false,
          kind: "undecidable",
          failed: "POLICY_UNREADABLE",
          reason: binding.reason,
        };
      }
      const existing = prospective.policy;
      if (existing && Array.isArray(existing.protected_paths) &&
          !samePolicy(existing.protected_paths, binding.policy.protected_paths)) {
        return {
          ok: false,
          kind: "undecidable",
          failed: "POLICY_CHANGED",
          reason: `the profile's \`protected_paths\` changed before the job was claimed (pinned [${[...existing.protected_paths].sort().join(", ") || "nothing"}], now [${[...binding.policy.protected_paths].sort().join(", ") || "nothing"}])`,
        };
      }
      prospective.policy = binding.policy;
    }

    // The transition must be a row of the table, and its trigger must hold.
    const verdict = validateJob(folder, { invariant: "INV-01", to, record: prospective });
    if (verdict.outcome !== PERMIT) {
      const failed = verdict.checks
        .filter((check) => check.outcome !== PERMIT)
        .map((check) => check.id);
      return {
        ok: false,
        kind: verdict.outcome === "reject" ? "illegal" : "undecidable",
        failed: failed.join(", ") || "INV-01",
        reason: verdict.reasons.join("; ") || "the transition could not be judged",
      };
    }

    // The retry budget and the round move TOGETHER, or the loop can spin:
    // `state-machine.md` spends one retry per repair, and a repair that
    // did not spend one would let a job fail forever. The tool enforces it
    // rather than trusting the caller to pass both.
    if (to === "repairing") {
      const before = record.retries_left;
      const after = prospective.retries_left;
      const roundBefore = record.round;
      const roundAfter = prospective.round;
      if (typeof after !== "number" || typeof roundAfter !== "number" ||
          after !== before - 1 || roundAfter !== roundBefore + 1) {
        return {
          ok: false,
          kind: "illegal",
          failed: "BUDGET_NOT_SPENT",
          reason: `a repair spends one retry and one round: \`retries_left\` must go ${before} -> ${before - 1} and \`round\` must go ${roundBefore} -> ${roundBefore + 1}`,
        };
      }
    }

    // The new record.
    const next = structuredClone(prospective);
    next.stage = to;
    next.updated_at = new Date().toISOString();

    // A park carries its reason.
    if (PARKED_STAGES.includes(to)) {
      const stated = next.cause;
      if (!(typeof stated === "string" && stated.trim().length > 0)) {
        return {
          ok: false,
          kind: "missing-cause",
          failed: "CAUSE_MISSING",
          reason: `a job at \`${to}\` must carry a cause, and none was given`,
        };
      }
    }

    // The main checkout must not have moved.
    const workspace = checkWorkspace(folder, record);
    if (!workspace.ok) return workspace;

    return { ok: true, record: next };
  });

  return { ...outcome, from, to };
}

/**
 * Record fields WITHOUT moving the job.
 *
 * Some of the record is field-recording and nothing else: the four review
 * verdicts, the approval and its binding, the spec approval, a spawned
 * session id, the restored retry budget. None of those is a stage change,
 * and none of them has a row in the transition table -- a stage that moved to
 * itself is not a transition, and the table does not say it is. A live run
 * found this the hard way: the orchestrator tried to record the approval
 * with a same-stage write, the one writer refused it (there is no such row),
 * and the approval could never be given.
 *
 * So this is the second kind of write, and it is narrow on purpose: the
 * stage does not move, the result must still validate against the schema,
 * and the main checkout must still be untouched.
 */
export function recordFields(folder, { sets = [], appends = [], cause = null }) {
  let from = null;
  // An ALLOWLIST, and a short one. A field write records what the pack's own
  // procedure records without moving the job -- the four review verdicts, the
  // approval and its binding, the spec approval, a spawned session id, the
  // restored retry budget, the full gate's result, the base commit isolation
  // recorded.
  //
  // `handoff` is NOT on the list, and that is the point. Only the guarded
  // tool knows whether a push happened and a pull request was opened; a record
  // that could merely CLAIM it would let a job reach `handed_off` with
  // neither, and the guard would be bypassed without touching a protected
  // file. A final review found exactly that, and it was a hole in the one
  // story the pack tells about its side effects.
  const offending = forbiddenRoots([...sets, ...appends]);
  if (offending.length > 0) {
    return {
      ok: false,
      kind: "illegal",
      failed: "FIELD_NOT_WRITABLE",
      reason: `a field write may not set \`${offending.join("`, `")}\` -- \`handoff\` belongs to the guarded tool alone, and the rest identify the job`,
    };
  }
  const outcome = writeRecord(folder, (record) => {
    from = record.stage;

    // The retry budget is reset by ONE thing: a human rework, and nothing
    // else. `/factory rework` says the job must be "at `needs_human` with an
    // exhausted budget", and until that is machine-checked the reset is a
    // promise rather than a rule -- a writer that kept handing the budget
    // back could spin the loop for ever, one reset at a time.
    const touchesBudget = [...sets, ...appends]
      .map((entry) => entry.slice(0, entry.indexOf("=") === -1 ? entry.length : entry.indexOf("=")))
      .some((path) => path === "retries_left" || path === "retry_budget_reset_at");
    if (touchesBudget) {
      if (record.stage !== "needs_human") {
        return {
          ok: false,
          kind: "illegal",
          failed: "REWORK_NOT_PARKED",
          reason: `the retry budget is reset by a human rework, and a rework is for a job parked at \`needs_human\`; this one is at \`${record.stage}\``,
        };
      }
      if (record.retries_left !== 0) {
        return {
          ok: false,
          kind: "illegal",
          failed: "REWORK_BUDGET_LEFT",
          reason: `a rework grants a fresh budget to a job whose budget is spent; this one has ${record.retries_left} left`,
        };
      }
    }

    const next = structuredClone(record);
    for (const entry of sets) {
      const at = entry.indexOf("=");
      applyField(next, entry.slice(0, at), parseValue(entry.slice(at + 1)));
    }
    for (const entry of appends) {
      const at = entry.indexOf("=");
      applyAppend(next, entry.slice(0, at), parseValue(entry.slice(at + 1)));
    }
    if (cause !== null) next.cause = cause;
    // The stage must NOT move. A field write that moved the job would be a
    // transition wearing a different hat.
    if (next.stage !== record.stage) {
      return {
        ok: false,
        kind: "illegal",
        failed: "STAGE_MOVED",
        reason: `a field write does not move the job, and the stage changed from \`${record.stage}\` to \`${next.stage}\``,
      };
    }
    next.updated_at = new Date().toISOString();
    const errors = validate(schema(), next);
    if (errors.length > 0) {
      return {
        ok: false,
        kind: "invalid",
        failed: "RECORD_INVALID",
        reason: `the record would not validate against \`schemas/job.schema.json\`: ${errors.join("; ")}`,
      };
    }
    const workspace = checkWorkspace(folder, record);
    if (!workspace.ok) return workspace;
    return { ok: true, record: next };
  });
  return { ...outcome, from };
}

/**
 * Record the four review verdicts FROM the artifacts that carry them.
 *
 * The review wave writes `round-<N>/review-{code,security,scope,visual}.md`.
 * The record's `reviews` object is a copy of those first lines, and a manual
 * copy is the step that transposes `PASS` and `CHANGES` or forgets one. This
 * mode makes the artifact the input: every file that exists is read exactly as
 * it is, and a file that does not exist is left alone.
 *
 * It is deliberately not a transition: the stage does not move, and a sync at
 * any stage records fields the way `--set-fields` does. The difference is
 * WHERE the values come from, and that a malformed file refuses the whole
 * write instead of recording the three that parsed.
 *
 * A no-op does not rewrite the record. That keeps "the record says what the
 * files say" from being a timestamp bump every time a wave is polled, and it
 * makes a sync over an untouched round byte-for-byte inert.
 */
export function syncFields(folder, { expectStage = null } = {}) {
  const held = acquireLock(folder, { tool: "transition" });
  if (!held.ok) {
    return { ok: false, kind: held.kind, failed: "LOCKED", reason: held.reason, owner: held.owner ?? null };
  }
  try {
    const read = readRecord(folder);
    if (!read.ok) {
      return {
        ok: false,
        kind: read.kind,
        failed: "RECORD_UNREADABLE",
        reason: `the record cannot be read (${read.reason})`,
      };
    }
    const record = read.value;
    const from = record.stage;
    if (expectStage && from !== expectStage) {
      return {
        ok: false,
        kind: "stale",
        failed: "STALE_RECORD",
        reason: `the record is at \`${from}\`, not the \`${expectStage}\` this call was made for`,
      };
    }
    const round = record.round;
    if (!Number.isInteger(round) || round < 0) {
      return {
        ok: false,
        kind: "undecidable",
        failed: "ROUND_UNKNOWN",
        reason: `the record's round is \`${round}\`, so there is no round folder to read`,
      };
    }

    const current = record.reviews && typeof record.reviews === "object" && !Array.isArray(record.reviews)
      ? record.reviews
      : {};
    const next = structuredClone(record);
    if (!next.reviews || typeof next.reviews !== "object" || Array.isArray(next.reviews)) {
      next.reviews = {};
    }
    const sync = { round, synced: [], unchanged: [], missing: [] };

    for (const role of ROLES) {
      const file = `round-${round}/review-${role}.md`;
      const artifact = readText(join(folder, file));
      if (!artifact.ok) {
        if (artifact.kind === "missing") {
          sync.missing.push({ role, file, current: typeof current[role] === "string" ? current[role] : null });
          continue;
        }
        return {
          ok: false,
          kind: "undecidable",
          failed: "VERDICT_UNREADABLE",
          reason: `${file} cannot be read (${artifact.reason})`,
        };
      }
      const parsed = parseVerdictFile(artifact.text);
      if (parsed.malformed) {
        return {
          ok: false,
          kind: "illegal",
          failed: "VERDICT_MALFORMED",
          reason: `${file} must begin with \`VERDICT: PASS\`, \`VERDICT: CHANGES\` or \`VERDICT: NOT_APPLICABLE\`; it begins with \`${parsed.first}\``,
        };
      }
      if (parsed.missingReason) {
        return {
          ok: false,
          kind: "illegal",
          failed: "VERDICT_REASON_MISSING",
          reason: `${file} is NOT_APPLICABLE but states no reason, which review.md treats like a missing file`,
        };
      }
      const before = typeof current[role] === "string" ? current[role] : null;
      if (before === parsed.verdict) {
        sync.unchanged.push({ role, file, verdict: parsed.verdict });
      } else {
        sync.synced.push({ role, file, from: before, to: parsed.verdict });
        next.reviews[role] = parsed.verdict;
      }
    }

    if (sync.synced.length === 0) {
      return { ok: true, changed: false, record, sync, from };
    }
    next.updated_at = new Date().toISOString();
    const errors = validate(schema(), next);
    if (errors.length > 0) {
      return {
        ok: false,
        kind: "invalid",
        failed: "RECORD_INVALID",
        reason: `the record would not validate against \`schemas/job.schema.json\`: ${errors.join("; ")}`,
      };
    }
    writeAtomic(join(folder, "job.json"), `${JSON.stringify(next, null, 2)}\n`);
    return { ok: true, changed: true, record: next, sync, from };
  } catch (error) {
    return {
      ok: false,
      kind: "error",
      failed: "WRITE_FAILED",
      reason: `the record could not be written (${error.message})`,
    };
  } finally {
    releaseLock(held.lockDir);
  }
}

/**
 * Create a record.
 *
 * The folder was claimed with a plain `mkdir` already, so the job id is
 * taken; this writes the record itself, once, under the same lock and the
 * same atomic rename every later write uses.
 */
export function createJob(folder, { record, sets = [] }) {
  const lock = acquireLock(folder, { tool: "transition" });
  if (!lock.ok) {
    return { ok: false, kind: lock.kind, failed: "LOCKED", reason: lock.reason, owner: lock.owner ?? null };
  }
  try {
    // A record is CREATED once. Writing over one that already exists would
    // be a second, unguarded writer: the stage could be reset, the approval
    // and its binding erased, the handoff record dropped -- silently, with
    // exit 0, and with no refusal in the log. The claim of the job id is
    // the `mkdir` that made the folder; this is the record's own claim.
    const existing = readRecord(folder);
    if (existing.ok) {
      return {
        ok: false,
        kind: "exists",
        failed: "RECORD_EXISTS",
        reason: `a record already exists in this job folder (stage \`${existing.value?.stage}\`) -- a record is created once, and a job that is already written is advanced, not replaced`,
      };
    }
    // The record must be the job the folder claims. A record that names
    // another job would be written into this job's folder and read back as
    // if it were this job's.
    const folderName = basename(folder);
    if (record?.id !== undefined && record.id !== folderName) {
      return {
        ok: false,
        kind: "mismatch",
        failed: "ID_MISMATCH",
        reason: `the record names job \`${record.id}\`, but the folder is \`${folderName}\``,
      };
    }
    const next = structuredClone(record);
    if (record && record.policy !== undefined) {
      return {
        ok: false,
        kind: "illegal",
        failed: "FIELD_NOT_WRITABLE",
        reason: "the policy binding is recorded by the tool when the job is claimed, and a record may not set it",
      };
    }
    // `--set` is the second create path. A policy root supplied that way
    // would otherwise be written AFTER the check above and become the
    // record's binding without the claim ever running.
    const offending = forbiddenRoots([...sets]);
    if (offending.length > 0) {
      return {
        ok: false,
        kind: "illegal",
        failed: "FIELD_NOT_WRITABLE",
        reason: `a record may not set \`${offending.join("`, `")}\` on creation -- the record's identity and its policy binding are written by the tool, not supplied by the caller`,
      };
    }
    for (const entry of sets) {
      const at = entry.indexOf("=");
      applyField(next, entry.slice(0, at), parseValue(entry.slice(at + 1)));
    }
    // The claim (`queued -> planning`) is the only write that binds the
    // policy. A record created at any later stage would never pass through
    // it, so it would be permanently unbound: every protected transition and
    // the handoff would have to refuse it. Creation therefore starts where
    // the claim can take it.
    if (next.stage !== "queued") {
      return {
        ok: false,
        kind: "illegal",
        failed: "STAGE_NOT_QUEUED",
        reason: `a record is created at \`queued\`, not \`${next.stage ?? "no stage"}\` -- the claim is the only write that binds the policy, so a later stage created directly would stay unbound`,
      };
    }
    next.updated_at = new Date().toISOString();
    const errors = validate(schema(), next);
    if (errors.length > 0) {
      return { ok: false, kind: "invalid", failed: "RECORD_INVALID",
        reason: `the record does not validate against \`schemas/job.schema.json\`: ${errors.join("; ")}` };
    }
    const workspace = checkWorkspace(folder, next);
    if (!workspace.ok) return workspace;
    writeAtomic(join(folder, "job.json"), `${JSON.stringify(next, null, 2)}\n`);
    return { ok: true, record: next };
  } catch (error) {
    return { ok: false, kind: "error", failed: "WRITE_FAILED",
      reason: `the record could not be written (${error.message})` };
  } finally {
    releaseLock(lock.lockDir);
  }
}

/**
 * Leave the refusal in the job's own log.
 *
 * The log is append-only and carries the job, the transition that was
 * attempted, the stage the job was in, the check that failed, the tool's own
 * conclusion and the time. It is written whether or not the lock could be
 * taken: a refusal is a refusal.
 */
export function recordRefusal(folder, { tool, attempted, failed, conclusion, reason, stage = null }) {
  const read = readRecord(folder);
  const record = read.ok ? read.value : null;
  return appendRejection(folder, {
    job: record?.id ?? basename(folder),
    tool,
    attempted,
    stage: stage ?? record?.stage ?? null,
    failed,
    conclusion,
    detail: reason,
  });
}

/** The conclusion a refusal carries. */
const conclusionFor = (kind) => {
  if (kind === "undecidable" || kind === "error" || kind === "unreadable" || kind === "unparseable") {
    return "inconclusive";
  }
  return "refused";
};

/** Run the tool. */
export function main(argv) {
  const { options, error } = parseArgs(argv);
  if (error) {
    process.stderr.write(`${error}\n\n${USAGE}\n`);
    return 3;
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const usageError = checkUsage(options);
  if (usageError) {
    // A misuse is not a transition, but it is still a refusal of the job,
    // and the log is where "why didn't this job move?" is answered. When
    // the job folder is there, the misuse is recorded beside the job.
    if (options.job) {
      const folder = resolve(options.job);
      if (existsSync(folder) && statSync(folder).isDirectory()) {
        recordRefusal(folder, {
          tool: "transition",
          attempted: options.to ? `->${options.to}` : "create",
          failed: "USAGE",
          conclusion: "refused",
          reason: usageError,
          stage: null,
        });
      }
    }
    process.stderr.write(`${usageError}\n\n${USAGE}\n`);
    return 3;
  }

  const folder = resolve(options.job);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    process.stderr.write(`--job must name a job folder that exists; \`${options.job}\` does not\n\n${USAGE}\n`);
    return 3;
  }

  let outcome;
  let attempted;
  if (options.sync) {
    outcome = syncFields(folder, { expectStage: options.expectStage });
    attempted = `sync verdicts at ${outcome.from ?? "?"}`;
  } else if (options.setFields) {
    outcome = recordFields(folder, {
      sets: options.sets,
      appends: options.appends,
      cause: options.cause,
    });
    attempted = `record fields at ${outcome.from ?? "?"}`;
  } else if (options.create) {
    attempted = "create";
    let record;
    try {
      record = JSON.parse(options.record);
    } catch (parseError) {
      process.stderr.write(`--record must be a JSON object; it does not parse (${parseError.message})\n\n${USAGE}\n`);
      return 3;
    }
    outcome = createJob(folder, { record, sets: options.sets });
  } else {
    outcome = advanceJob(folder, {
      to: options.to,
      expectStage: options.expectStage,
      sets: options.sets,
      appends: options.appends,
      cause: options.cause,
    });
    attempted = `${outcome.from ?? "?"}->${options.to}`;
  }

  if (!outcome.ok) {
    const conclusion = conclusionFor(outcome.kind);
    // The holder of the lock belongs in the durable record, not only on the
    // terminal: a person reading `rejections.log` to explain a stuck job
    // needs to know WHO holds it, and a pid and a tool are what that takes.
    const reason = outcome.kind === "locked" && outcome.owner
      ? `${outcome.reason} -- held by ${JSON.stringify(outcome.owner)}`
      : outcome.reason;
    recordRefusal(folder, {
      tool: "transition",
      attempted,
      failed: outcome.failed ?? outcome.kind,
      conclusion,
      reason,
      stage: outcome.from ?? null,
    });
    // The reason is masked before it is printed as well as before it is
    // logged: a credential in a terminal's scrollback is a leak too.
    const report = {
      job: folder,
      outcome: conclusion,
      failed: outcome.failed ?? outcome.kind,
      reason: redact(outcome.reason),
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stderr.write(`${conclusion}  ${outcome.failed ?? outcome.kind}: ${redact(outcome.reason)}\n`);
      if (outcome.kind === "locked" && outcome.owner) {
        process.stderr.write(`        the lock is held by ${JSON.stringify(outcome.owner)}\n`);
      }
    }
    return exitCodeFor(conclusion);
  }

  const report = {
    job: folder,
    outcome: "ok",
    stage: outcome.record.stage,
    updated_at: outcome.record.updated_at,
  };
  if (options.sync) {
    report.changed = outcome.changed;
    report.round = outcome.sync.round;
    report.synced = outcome.sync.synced;
    report.unchanged = outcome.sync.unchanged;
    report.missing = outcome.sync.missing;
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (options.sync) {
    const { round, synced, unchanged, missing } = outcome.sync;
    process.stdout.write(
      `ok  round ${round}: ${synced.length} synced, ${unchanged.length} unchanged, ${missing.length} missing\n`);
    for (const entry of synced) {
      process.stdout.write(`    ${entry.role.padEnd(8)} ${entry.from ?? "?"} -> ${entry.to}\n`);
    }
    for (const entry of missing) {
      process.stdout.write(`    ${entry.role.padEnd(8)} ${entry.file} missing; left as ${entry.current ?? "?"}\n`);
    }
  } else {
    process.stdout.write(`ok  ${outcome.record.stage}\n`);
  }
  return 0;
}

// Run as a program? `import.meta.main` does not exist before Node 22.18.0,
// and a CLI whose entry point silently does nothing is a false green. Compare
// the argument vector with this module's own path instead.
const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
