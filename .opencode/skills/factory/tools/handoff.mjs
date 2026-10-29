#!/usr/bin/env node
// pack/tools/handoff.mjs
//
// The guarded protected action.
//
// The protected side effect of this pack is the one that leaves the machine:
// pushing the job branch and opening the pull request. Until now the
// orchestrator did that by running `git push` and `gh pr create` itself,
// guided by prose in the skill. Prose is not a boundary.
//
// This tool IS the boundary. It performs the side effect, and it verifies
// before it performs it:
//
//   - the change identity matches the approval that authorised it,
//   - the six §14.2 preconditions hold,
//   - the verification evidence is complete and current,
//   - the four review verdicts are clean,
//   - the full gate is recorded as `passed`,
//   - the record is at `approved_to_merge`, and
//   - the push target is the job branch, never the base branch.
//
// If any of those fails it refuses, names the failed precondition, and changes
// no protected state: the push does not happen and the pull request is not
// opened. The refusal itself is appended to the job's `rejections.log`, because
// a refusal nobody can read is a refusal nobody can investigate. It never
// merges: there is no merge in this file, and the pull request it opens is
// left open for a person.
//
//   node tools/handoff.mjs --job <job-folder> [--remote <name-or-path>] [--json]
//
// Exit codes:
//
//   0  the handoff happened: the job branch was pushed, the PR was opened,
//      and the outcome was recorded in the job record
//   1  refused: a precondition failed, and the reason names it
//   2  inconclusive: an input could not be read, so nothing could be decided
//   3  usage error
//   4  the side effect failed: the push or the pull request did not go through
//
// It has no dependencies beyond `node:` builtins, no clock in any decision, no
// network beyond the push and the pull request themselves, and no randomness.
// It writes four things: the pull request's body file, the remote branch, the
// `handoff` block of the job record, and the main checkout's baseline listing
// (taken once, then reused by the workspace guard). The `handoff` block goes
// through `tools/transition.mjs`, the pack's one writer of the record, so there
// is one lock and one atomic write behind every change to `job.json`.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./schema-validator.mjs";
import { schemaPath } from "./lib/pack-paths.mjs";
import { changeIdentity, worktreeOf } from "./lib/change-identity.mjs";
import { implementedPreconditions } from "./lib/preconditions.mjs";
import { checkPolicyBinding } from "./lib/profile.mjs";
import { openJob, ROLES, repoRootFor } from "./lib/job-folder.mjs";
import { BASELINE_NAME, guardMainCheckout } from "./lib/main-checkout.mjs";
import { acquireLock, appendRejection, readRecord, redact, releaseLock, writeAtomic } from "./lib/record-store.mjs";
import { writeRecord } from "./transition.mjs";

const USAGE = `usage:
  node tools/handoff.mjs --job <job-folder> [--remote <name-or-path>] [--json]

exit codes:
  0  the handoff happened
  1  refused: a precondition failed
  2  inconclusive: an input could not be read
  3  usage error
  4  the side effect failed

The tool pushes the job branch and opens the pull request. It never merges,
and it never pushes to the base branch.`;

/** The exit code an outcome maps to. */
const exitCodeFor = (outcome) => {
  if (outcome === "ok") return 0;
  if (outcome === "refused") return 1;
  if (outcome === "inconclusive") return 2;
  if (outcome === "failed") return 4;
  return 3;
};

/** Parse the command line. An unknown flag is a usage error, not a default. */
export function parseArgs(argv) {
  const options = { job: null, remote: "origin", json: false, help: false };
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
      case "--remote":
        options.remote = argv[++index] ?? null;
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
  if (!options.remote) return "--remote must name a remote or a path";
  return null;
}

/**
 * Run one command. Never throws; every failure is a value.
 *
 * `git push` and `gh pr create` are the only commands this tool runs that
 * write anything, and both are the side effects it exists to perform.
 */
function run(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error) {
    return { ok: false, status: null, out: "", err: result.error.message };
  }
  return {
    ok: result.status === 0,
    status: result.status,
    out: (result.stdout ?? "").trim(),
    err: (result.stderr ?? "").trim(),
  };
}

/**
 * The pull request's body.
 *
 * `reference/approval.md` says the body is an appendix and never the
 * evidence: it points at the evidence path, and the evidence itself lives in
 * the job folder.
 */
export function prBody(context) {
  const record = context.record;
  const round = context.round ?? 0;
  const lines = [
    `Job: ${record.id}`,
    `Feature: ${record.feature}`,
    "",
    `Base branch: ${record.base_branch}`,
    `Job branch: ${record.branch}`,
    `Approved change: ${record.approval?.diff_ref ?? "(none)"}`,
    `Approved against base: ${record.approval?.base_commit ?? "(none)"}`,
    "",
    `Evidence: factory/jobs/${record.id}/evidence.json`,
    `Verdicts: factory/jobs/${record.id}/round-${round}/review-{code,security,scope,visual}.md`,
    `Decision: factory/jobs/${record.id}/decision.md`,
    "",
    "This pull request was opened by the feature factory. It was NOT merged.",
  ];
  return `${lines.join("\n")}\n`;
}

/** The pull request's title: the job, and the change in one line. */
export function prTitle(record) {
  const feature = String(record.feature ?? "").split("\n")[0].trim();
  const title = `${record.id}: ${feature}`;
  return title.length > 100 ? `${title.slice(0, 97)}...` : title;
}

/**
 * The four verdict files, read.
 *
 * A verdict that is missing, malformed, or carries a blocking finding stops
 * the handoff, and the reason names the file.
 */
export function checkVerdicts(context) {
  const problems = [];
  for (const role of ROLES) {
    const verdict = context.verdict(role);
    if (!verdict) {
      problems.push({ file: `round-?/review-${role}.md`, detail: "the record carries no round, so the verdict files cannot be found" });
      continue;
    }
    if (!verdict.ok) {
      problems.push({
        file: verdict.file,
        detail: verdict.kind === "missing" ? "it does not exist" : `it cannot be read (${verdict.reason})`,
      });
      continue;
    }
    if (verdict.malformed) {
      problems.push({ file: verdict.file, detail: `it opens with \`${verdict.first}\`, which is not a legal verdict` });
      continue;
    }
    if (verdict.missingReason) {
      problems.push({ file: verdict.file, detail: "it is a `NOT_APPLICABLE` with no stated reason" });
      continue;
    }
    if (verdict.blocking) {
      problems.push({ file: verdict.file, detail: "it carries a blocking finding" });
      continue;
    }
  }
  return problems;
}

/**
 * The record's own validity.
 *
 * The tool writes into the record, so it refuses a record that does not
 * validate: a malformed record must not be the one that says a handoff
 * happened.
 */
function checkRecord(record) {
  let schema;
  try {
    schema = JSON.parse(readFileSync(schemaPath("job.schema.json"), "utf8"));
  } catch (error) {
    // Every failure is a value: a tool that throws on a missing schema
    // reports a stack trace, and a stack trace is not an answer an operator
    // can act on.
    return { ok: false, detail: `the pack's job schema cannot be read (${error.message})` };
  }
  const errors = validate(schema, record);
  return errors.length === 0 ? { ok: true } : { ok: false, detail: errors.join("; ") };
}

/**
 * Everything the tool verifies, before it acts.
 *
 * The result is a list of problems, each naming what failed. An empty list
 * means the handoff may go ahead.
 */
export function verify(context) {
  const problems = [];
  const record = context.record;

  const validity = checkRecord(record);
  if (!validity.ok) {
    problems.push({ what: "the record", detail: `it does not validate against the job schema (${validity.detail})` });
    return { problems, outcome: "refused" };
  }

  // The protected action may not leave the machine on a job that is judged by
  // a policy it no longer holds. The claim bound the policy; the handoff checks
  // the binding again, so a policy that moved after the change was verified
  // stops the push before it happens.
  const policy = checkPolicyBinding(record.policy, context.repoRoot);
  if (!policy.ok) {
    problems.push({ what: "the protected-path policy", detail: policy.reason, undecidable: true });
  }

  // The stage the transition requires.
  if (record.stage !== "approved_to_merge") {
    problems.push({
      what: "the stage",
      detail: `the record is at \`${record.stage}\`, not \`approved_to_merge\``,
    });
  }

  // Once. A handoff that has already happened cannot happen again: the
  // protected action is the one thing in this pack that leaves the machine,
  // and a second run of it opens a second pull request over the same branch
  // while overwriting the record of the first. Refusing here is what makes
  // "authorises exactly one push" true across runs, not just within one.
  if (record.handoff) {
    problems.push({
      what: "the record",
      detail: `a handoff is already recorded (\`${record.handoff.pr_url ?? record.handoff.ref}\`) -- the protected action happens once`,
    });
  }

  // The authorization. An approval that names no job, another job, no
  // approver, or no change authorises nothing.
  const approval = record.approval ?? {};
  if (approval.approved !== true) {
    problems.push({ what: "the authorization", detail: "the record carries no approval" });
  } else {
    if (typeof approval.diff_ref !== "string" || approval.diff_ref.trim().length === 0) {
      problems.push({ what: "the authorization", detail: "the approval records no diff reference" });
    }
    if (typeof approval.job !== "string" || approval.job.trim().length === 0) {
      problems.push({ what: "the authorization", detail: "the approval names no job" });
    } else if (approval.job !== record.id) {
      problems.push({
        what: "the authorization",
        detail: `the approval names job \`${approval.job}\`, not \`${record.id}\``,
      });
    }
    if (typeof approval.approver !== "string" || approval.approver.trim().length === 0) {
      problems.push({ what: "the authorization", detail: "the approval names no approver" });
    }
  }

  // The identity of the change is checked by §14.2 precondition 1 below: that
  // precondition IS the binding check, and it names the mismatch -- an
  // approval recorded for another change is a replay, and a replay
  // authorises nothing.

  // The six §14.2 preconditions.
  for (const entry of implementedPreconditions(context)) {
    if (entry.result.undecidable) {
      problems.push({
        what: `§14.2 precondition ${entry.n}`,
        detail: entry.result.detail,
        undecidable: true,
      });
    } else if (!entry.result.holds) {
      problems.push({ what: `§14.2 precondition ${entry.n}`, detail: entry.result.detail });
    }
  }

  // The four verdict files.
  for (const problem of checkVerdicts(context)) {
    problems.push({ what: `the verdict file \`${problem.file}\``, detail: problem.detail });
  }

  // The full gate, run once before the handoff and recorded by the
  // orchestrator. The tool does not run it -- it is not the tool's command --
  // but it does not hand off without it either.
  const fullGate = record.full_gate;
  if (!fullGate || typeof fullGate !== "object") {
    problems.push({ what: "the full gate", detail: "no full gate result is recorded" });
  } else if (fullGate.result !== "passed") {
    problems.push({ what: "the full gate", detail: `it is \`${fullGate.result}\`` });
  }

  // The push target. The pack never pushes to the base branch.
  const branch = record.branch;
  if (typeof branch !== "string" || branch.trim().length === 0) {
    problems.push({ what: "the push target", detail: "the record names no branch to push" });
  } else if (branch === record.base_branch) {
    problems.push({
      what: "the push target",
      detail: `the job branch is the base branch \`${branch}\` -- the pack never pushes to the base branch`,
    });
  }

  const undecidable = problems.every((problem) => problem.undecidable);
  // The verified identity travels with the verdict: the push names the commit
  // this verification bound the approval to, not whatever the branch points
  // at a moment later.
  const identity = changeIdentity(context);
  return {
    problems,
    verified: identity.ok ? { identity: identity.identity } : null,
    outcome: problems.length === 0 ? "ok" : (undecidable ? "inconclusive" : "refused"),
  };
}

/**
 * The handoff itself: push the job branch, open the pull request, record
 * what happened.
 *
 * The refspec names the job branch on both sides, so the base branch cannot
 * be touched even by accident.
 *
 * The SOURCE of the push is the commit that was VERIFIED, not the branch
 * name. A branch name is resolved again, at push time: a branch that moved
 * between the verification and the push would carry a commit nobody
 * approved. Naming the commit pins the content, and git's own
 * non-fast-forward rule then refuses the push if the branch moved on in the
 * meantime -- which fails closed, where a refspec naming the branch would
 * have shipped the change silently.
 */
export function handoff(context, { remote = "origin", verified = null } = {}) {
  const record = context.record;
  const branch = record.branch;
  const ref = `refs/heads/${branch}`;
  const worktree = worktreeOf(context);
  if (!worktree.ok) return { ok: false, failed: "NO_WORKTREE", reason: worktree.reason };

  // The commit the verification bound the approval to. Without it there is
  // nothing to push but a name, and a name is not a change.
  const source = verified?.identity?.branch_commit ?? null;
  if (!source) {
    return {
      ok: false,
      reason: "the verified commit is not known, so there is no content to push",
    };
  }

  const bodyFile = resolve(context.folder, "pr-body.md");
  writeFileSync(bodyFile, prBody(context));

  // `--no-follow-tags` keeps the side effect to the one ref: a repository
  // with `push.followTags` set would otherwise ship extra tags this tool
  // never agreed to send.
  const push = run("git", ["push", "--no-follow-tags", remote, `${source}:${ref}`], { cwd: worktree.path });
  if (!push.ok) {
    return {
      ok: false,
      failed: "PUSH_FAILED",
      reason: `the push of \`${branch}\` to \`${remote}\` failed (${push.err || `git push exited ${push.status}`})`,
    };
  }

  const pr = run("gh", [
    "pr", "create",
    "--base", record.base_branch,
    "--head", branch,
    "--title", prTitle(record),
    "--body-file", bodyFile,
  ], { cwd: worktree.path });
  if (!pr.ok) {
    return {
      ok: false,
      failed: "PR_FAILED",
      reason: `the pull request could not be opened (${pr.err || `gh pr create exited ${pr.status}`})`,
    };
  }

  const prUrl = pr.out.length > 0 ? pr.out.split("\n").pop().trim() : null;
  return { ok: true, branch, ref, pr_url: prUrl, pushed: true };
}

/**
 * Record the outcome in the job record.
 *
 * Exactly one field is written: `handoff`. The stage fields belong to the
 * orchestrator, and a tool that wrote them would be a second writer of the
 * record's stages.
 *
 * The write goes through `tools/transition.mjs` -- the pack's one writer of
 * the record -- so it takes the same exclusive lock and the same atomic
 * rename every other change to `job.json` takes. Two writers of one record
 * is the failure this pack exists to prevent, and a protected action that
 * wrote the record on its own would be exactly that.
 */
export function recordHandoff(context, outcome, { lock = null } = {}) {
  return writeRecord(context.folder, (record) => ({
    ok: true,
    record: {
      ...record,
      handoff: {
        branch: outcome.branch,
        ref: outcome.ref,
        pushed: outcome.pushed,
        pr_url: outcome.pr_url ?? null,
        at: new Date().toISOString(),
      },
    },
  }), { lock });
}

/**
 * The main checkout's guard, before the push.
 *
 * The same check the transition writer makes, for the same reason: the push
 * is the one step that leaves the machine, and it must not happen over a
 * working tree the factory changed.
 */
export function checkWorkspace(folder) {
  const guard = guardMainCheckout(folder, repoRootFor(folder));
  if (!guard.ok) {
    return {
      ok: false,
      outcome: guard.kind === "undecidable" ? "inconclusive" : "refused",
      what: "the main checkout",
      detail: guard.reason,
      failed: "MAIN_CHECKOUT_CHANGED",
    };
  }
  if (guard.recorded) {
    writeAtomic(join(folder, BASELINE_NAME), guard.baseline);
  }
  return { ok: true };
}

/**
 * Leave the refusal in the job's own log.
 *
 * The log is append-only, so a later attempt never overwrites this refusal,
 * and it carries the job, the action that was attempted, the stage the job
 * was in, what failed, the tool's own conclusion and the time.
 */
export function recordRefusal(folder, { attempted, failed, conclusion, reason, stage = null }) {
  const read = readRecord(folder);
  const record = read.ok ? read.value : null;
  return appendRejection(folder, {
    job: record?.id ?? null,
    tool: "handoff",
    attempted,
    stage: stage ?? record?.stage ?? null,
    failed,
    conclusion,
    detail: reason,
  });
}

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
    process.stderr.write(`${usageError}\n\n${USAGE}\n`);
    return 3;
  }

  const folder = resolve(options.job);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    process.stderr.write(`--job must name a job folder that exists; \`${options.job}\` does not\n\n${USAGE}\n`);
    return 3;
  }

  const context = openJob(folder);
  if (!context.record) {
    const reason = context.recordError?.reason ?? "unknown";
    // The record cannot be read, but the refusal can still be recorded: the
    // job's own folder is there even when its record is not, and "the
    // record is unreadable" is exactly what a human needs to be told.
    recordRefusal(folder, {
      attempted: "push the job branch and open the pull request",
      failed: "RECORD_UNREADABLE",
      conclusion: "inconclusive",
      reason: `the record cannot be read (${reason}), so the handoff cannot be judged`,
      stage: null,
    });
    process.stderr.write(`the record cannot be read (${reason}), so the handoff cannot be judged\n`);
    return 2;
  }

  // The whole protected action is ONE exclusive run: the verification, the
  // push, the pull request and the record. Without the lock, two handoffs
  // could both pass the verification -- the record does not yet carry a
  // handoff -- and both push and both open a pull request, and the record
  // would keep only one of them. The lock is the same `mkdir` claim the
  // transition writer uses, and it is released on every path.
  const lock = acquireLock(folder, { tool: "handoff" });
  if (!lock.ok) {
    process.stderr.write(
      `refused  LOCKED: ${redact(lock.reason)}${lock.owner ? ` -- held by ${JSON.stringify(lock.owner)}` : ""}\n`);
    return 1;
  }
  try {

  /**
   * Refuse, and leave the refusal behind.
   *
   * A refusal that leaves no record is a refusal a human cannot read: the
   * job sits where it was and nothing says why.
   */
  const refuse = ({ what, detail, outcome = "refused", failed = "PRECONDITION_FAILED" }) => {
    recordRefusal(folder, {
      attempted: "push the job branch and open the pull request",
      failed,
      conclusion: outcome,
      reason: `${what}: ${detail}`,
      stage: context.record?.stage ?? null,
    });
    const report = {
      job: context.folder,
      outcome,
      problems: [{ what, detail: redact(detail) }],
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stderr.write(`${outcome}  ${what}: ${redact(detail)}\n`);
    }
    return exitCodeFor(outcome);
  };

  const verdict = verify(context);
  if (verdict.outcome !== "ok") {
    const lines = verdict.problems.map((problem) => `${problem.what}: ${problem.detail}`);
    recordRefusal(folder, {
      attempted: "push the job branch and open the pull request",
      failed: "PRECONDITION_FAILED",
      conclusion: verdict.outcome,
      reason: lines.join("; "),
      stage: context.record?.stage ?? null,
    });
    const report = {
      job: context.folder,
      outcome: verdict.outcome,
      problems: verdict.problems.map((problem) => ({ what: problem.what, detail: redact(problem.detail) })),
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      // The label says what happened: a refusal and an undecidable run are
      // different answers, and a reader must not have to open the JSON to
      // tell them apart.
      const label = verdict.outcome === "inconclusive" ? "inconclusive" : "refused";
      for (const line of lines) process.stderr.write(`${label}  ${line}\n`);
    }
    return exitCodeFor(verdict.outcome);
  }

  // The main checkout, before the push. The same guard the transition writer
  // applies, and for the same reason: nothing outside `factory/jobs/` in the
  // user's checkout may have moved under a protected action.
  const workspace = checkWorkspace(folder);
  if (!workspace.ok) {
    return refuse({ what: workspace.what, detail: workspace.detail, outcome: workspace.outcome, failed: workspace.failed });
  }

  const outcome = handoff(context, { remote: options.remote, verified: verdict.verified });
  if (!outcome.ok) {
    // A push that fails half way, or a pull request that cannot be opened,
    // is the failure a human most needs in the durable record -- and it is
    // still a refusal. The reason is redacted on the way out: a git or gh
    // error routinely quotes the remote's URL, and a URL can carry a token.
    recordRefusal(folder, {
      attempted: `${context.record.stage}->handed_off`,
      failed: outcome.failed ?? "HANDOFF_FAILED",
      conclusion: "refused",
      reason: outcome.reason,
      stage: context.record.stage,
    });
    process.stderr.write(`the handoff did not go through: ${redact(outcome.reason)}\n`);
    return 4;
  }
  const recorded = recordHandoff(context, outcome, { lock });
  if (!recorded.ok) {
    return refuse({
      what: "the record",
      detail: `the handoff happened but the record could not carry it (${recorded.reason})`,
      outcome: "inconclusive",
      failed: recorded.failed ?? "RECORD_UNWRITTEN",
    });
  }

  const report = {
    job: context.folder,
    outcome: "handed_off",
    branch: outcome.branch,
    ref: outcome.ref,
    pushed: true,
    pr_url: outcome.pr_url,
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`pushed    ${outcome.ref} to ${options.remote}\n`);
    process.stdout.write(`pr        ${outcome.pr_url ?? "(no url)"}\n`);
    process.stdout.write("handed_off\n");
  }
  return 0;
  } finally {
    releaseLock(lock.lockDir);
  }
}

// Run as a program? `import.meta.main` does not exist before Node 22.18.0,
// and a CLI whose entry point silently does nothing is a false green. Compare
// the argument vector with this module's own path instead.
const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
