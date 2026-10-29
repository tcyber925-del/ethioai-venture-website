#!/usr/bin/env node
// pack/tools/validate.mjs
//
// The validator: a local, read-only, deterministic check on whether a job may
// advance.
//
//   node tools/validate.mjs --job <job-folder> --invariant <INV-01|INV-02|INV-03|INV-04> [--to <stage>] [--json]
//   node tools/validate.mjs --job <job-folder> --all [--to <stage>] [--json]
//
// Exit codes are the contract:
//
//   0  permit        the inspected inputs satisfy the invariant
//   1  reject        the inspected inputs violate it, on concrete evidence
//   2  inconclusive  the validator could not decide
//   3  usage error
//
// A non-zero exit is never a pass. `inconclusive` is not a soft reject and not
// a permit: it means the validator could not read what it judges from, and an
// unanswered question must not authorise progress.
//
// The tool never writes. It reads the job folder, reads the pack's own
// references and schemas, and asks git four read-only questions. It has no
// dependencies beyond `node:` builtins, and no clock, no network and no
// randomness: two runs over the same inputs give the same answer.
//
// `reference/validator.md` is the contract this file implements.
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkInv01, checkInv02, checkInv03, checkInv04 } from "./lib/invariants.mjs";
import { openJob } from "./lib/job-folder.mjs";
import { PERMIT, REJECT, reason, worst } from "./lib/reasons.mjs";
import { loadTransitions } from "./lib/state-machine.mjs";

const INVARIANTS = ["INV-01", "INV-02", "INV-03", "INV-04"];

const USAGE = `usage:
  node tools/validate.mjs --job <job-folder> --invariant <INV-01|INV-02|INV-03|INV-04> [--to <stage>] [--json]
  node tools/validate.mjs --job <job-folder> --all [--to <stage>] [--json]

exit codes:
  0  permit        the inspected inputs satisfy the invariant
  1  reject        the inspected inputs violate it, on concrete evidence
  2  inconclusive  the validator could not decide
  3  usage error

--to names the transition INV-01 is about. It is required for INV-01 and
rejected for the other three. With --all it applies to INV-01 only, and
without it INV-01 is not evaluated: a transition needs a target.

The tool is read-only. It writes nothing, mutates no git state, and needs
Node 22.18.0 or newer.`;

/** The exit code an outcome maps to. */
const exitCodeFor = (outcome) => {
  if (outcome === PERMIT) return 0;
  if (outcome === REJECT) return 1;
  return 2;
};

/**
 * Parse the command line.
 *
 * An unknown flag, a missing value, or a flag used where it does not belong is
 * a usage error, not a default. Exit code 3 says the question was malformed;
 * it never stands in for an answer.
 */
export function parseArgs(argv) {
  const options = { job: null, invariant: null, all: false, to: null, json: false, help: false };
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
      case "--invariant":
        options.invariant = argv[++index] ?? null;
        break;
      case "--all":
        options.all = true;
        break;
      case "--to":
        options.to = argv[++index] ?? null;
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
  if (options.all && options.invariant) return "--all and --invariant cannot be combined";
  if (!options.all && !options.invariant) return "one of --invariant or --all is required";
  if (options.invariant && !INVARIANTS.includes(options.invariant)) {
    return `--invariant must be one of ${INVARIANTS.join(", ")}`;
  }
  if (options.to && options.invariant && options.invariant !== "INV-01") {
    return `--to applies to INV-01 only, not ${options.invariant}`;
  }
  if (options.invariant === "INV-01" && !options.to) {
    return "--to <stage> is required for INV-01";
  }
  if (options.to) {
    const stages = loadTransitions().stages;
    if (!stages.includes(options.to)) {
      return `--to must name a stage of the state machine, not \`${options.to}\``;
    }
  }
  return null;
}

/**
 * Run the requested checks.
 *
 * `invariant` is an invariant id, or "all". The result names the outcome, the
 * checks that produced it and the reasons behind it.
 */
export function validateJob(folder, { invariant = "all", to = null, record = null } = {}) {
  // `record` lets a caller judge a PROSPECTIVE record -- the one a write
  // would produce -- rather than the one on disk. The transition writer
  // needs that: a trigger like "the record says `spec_approved`" must be
  // read against the record the write would leave behind, or the field the
  // write sets can never satisfy the rule that permits it.
  const context = openJob(folder);
  // `current` is the record as it is on disk; `record` is the one being
  // judged. A trigger that asks "is there a retry left?" must read the
  // record BEFORE the write spends it -- the retry that remains is the one
  // the budget had, not the one the write leaves behind. A trigger that
  // asks "does the record say the spec was approved?" must read the
  // prospective record, because that is the record the write produces.
  context.current = context.record;
  if (record) context.record = record;
  const checks = [];
  const wanted = invariant === "all" ? INVARIANTS : [invariant];

  for (const id of wanted) {
    if (id === "INV-01") {
      if (!to) {
        // INV-01 is a question about ONE transition. With `--all` and no
        // `--to` there is no transition to ask about, so the invariant is not
        // evaluated -- and saying so is better than answering a question
        // nobody asked.
        checks.push(reason("INV-01/NOT_EVALUATED", {}));
        continue;
      }
      checks.push(...checkInv01(context, { to }).checks);
      continue;
    }
    if (id === "INV-02") checks.push(...checkInv02(context).checks);
    else if (id === "INV-03") checks.push(...checkInv03(context).checks);
    else if (id === "INV-04") checks.push(...checkInv04(context).checks);
  }

  const outcome = worst(checks);
  return {
    job: context.folder,
    invariant,
    outcome,
    checks: checks.map(({ id: checkId, outcome: checkOutcome, detail }) => ({
      id: checkId,
      outcome: checkOutcome,
      detail,
    })),
    reasons: checks.filter((check) => check.outcome !== PERMIT).map((check) => check.detail),
  };
}

/** Print the report. */
function report(result, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const width = Math.max(0, ...result.checks.map((check) => check.id.length));
  for (const check of result.checks) {
    process.stdout.write(`${check.id.padEnd(width)}  ${check.outcome.padEnd(12)}  ${check.detail}\n`);
  }
  process.stdout.write(`${result.outcome}\n`);
}

/** The command line entry point. */
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
    process.stderr.write(`${usageError}\n\n${USAGE}\n`);
    return 3;
  }

  const folder = resolve(options.job);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    process.stderr.write(`--job must name a job folder that exists; \`${options.job}\` does not\n\n${USAGE}\n`);
    return 3;
  }

  const result = validateJob(folder, {
    invariant: options.all ? "all" : options.invariant,
    to: options.to,
  });
  report(result, options.json);
  return exitCodeFor(result.outcome);
}

// Run as a program? `import.meta.main` does not exist before Node 22.18.0,
// and a CLI whose entry point silently does nothing is a false green. Compare
// the argument vector with this module's own path instead.
const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
