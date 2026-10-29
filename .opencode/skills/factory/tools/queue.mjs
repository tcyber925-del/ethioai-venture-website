#!/usr/bin/env node
// pack/tools/queue.mjs
//
// The read-only answer to "what can dispatch claim next, and why not the rest?"
//
// /factory dispatch used to make the orchestrator resolve `depends_on` by hand,
// every wave: read each dependency's pull request, fetch the base, and require
// the dependency's merge commit to be an ancestor of it. Prose is not a check.
// This tool performs the same reading once, for every job, and prints the
// result:
//
//   - one row per job in `factory/jobs/`, not only the queued ones;
//   - the stage's required artifacts, present or missing;
//   - the pull request state for a job that has handed off;
//   - for a queued job, whether it is eligible, and every reason it is not.
//
// It never writes a record, claims a worktree, or moves a stage. The one write
// it can make is `git fetch origin <base_branch>`, and only when a merged
// dependency needs its merge commit checked: a fetch writes remote refs, not
// the tracked tree, and without it a report about a remote merge would be
// about how stale this clone happens to be.
//
// Exit codes:
//   0  a report was printed (waiting jobs are not an error)
//   2  the queue could not be read at all
//   3  usage error
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openJob } from "./lib/job-folder.mjs";
import { stageArtifacts } from "./lib/invariants.mjs";
import { gitIsAncestor, gitRevParse } from "./lib/git.mjs";

const USAGE = `usage:
  node tools/queue.mjs [--root <repo>] [--json] [--eligible] [--no-fetch]

Reads factory/jobs/*/job.json and reports every job. A queued job is eligible
when it has no dependencies, or when every id in depends_on has a MERGED pull
request whose merge commit is an ancestor of the branch the job will branch
from. An ineligible job stays queued; the reason names the dependency.

  --root <repo>   the repository that holds factory/jobs (default: cwd)
  --json          print the whole report as one JSON document
  --eligible      print only the ids dispatch may claim, one per line
  --no-fetch      do not run git fetch; judge containment from the refs as they are

exit codes:
  0  a report was printed
  2  the queue could not be read
  3  usage error`;

/** The next action a human or the orchestrator takes for a stage. */
const ACTIONS = Object.freeze({
  intake: "intake",
  needs_clarification: "intake",
  queued: "dispatch",
  planning: "continue",
  awaiting_plan_approval: "go",
  building: "continue",
  verifying: "continue",
  repairing: "continue",
  reviewing: "continue",
  awaiting_human_review: "approve",
  approved_to_merge: "handoff",
  handed_off: "await-merge",
  merged: "done",
  needs_human: "recover",
  blocked: "recover",
  rejected: "done",
  cancelled: "done",
});

/** Parse the command line. An unknown flag is a usage error, not a default. */
export function parseArgs(argv) {
  const options = { root: null, json: false, eligible: false, fetch: true, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--root":
        options.root = argv[++index] ?? null;
        break;
      case "--json":
        options.json = true;
        break;
      case "--eligible":
        options.eligible = true;
        break;
      case "--no-fetch":
        options.fetch = false;
        break;
      default:
        return { error: `unknown argument: ${flag}` };
    }
  }
  if (!options.help && !options.root) options.root = process.cwd();
  return { options };
}

/** Every directory under `factory/jobs`, by id. A folder with no record is a row too. */
export function jobFolders(root) {
  const jobs = join(root, "factory", "jobs");
  if (!existsSync(jobs)) return [];
  return readdirSync(jobs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((id) => ({ id, folder: join(jobs, id) }));
}

/** The pull request state a gh answer names, lowercased, or null. */
function prState(value) {
  const state = typeof value === "string" ? value.toLowerCase() : null;
  return ["open", "merged", "closed"].includes(state) ? state : null;
}

/**
 * Read one pull request.
 *
 * The answer is cached for the run: several jobs may depend on the same pull
 * request, and asking GitHub the same question twice is a second chance to get
 * a different answer. `mergeCommit` is read in the same call because a merged
 * dependency needs it, and two calls could straddle a merge.
 */
function prReader() {
  const cache = new Map();
  return (url) => {
    if (cache.has(url)) return cache.get(url);
    const result = spawnSync("gh", ["pr", "view", url, "--json", "state,mergeCommit"], {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error) {
      const answer = { ok: false, reason: `gh could not be run (${result.error.message})` };
      cache.set(url, answer);
      return answer;
    }
    if (result.status !== 0) {
      const detail = (result.stderr ?? "").trim();
      const answer = {
        ok: false,
        reason: `gh pr view exited ${result.status}${detail ? ` (${detail.split("\n")[0]})` : ""}`,
      };
      cache.set(url, answer);
      return answer;
    }
    let value;
    try {
      value = JSON.parse(result.stdout ?? "");
    } catch (error) {
      const answer = { ok: false, reason: `the gh answer is not JSON (${error.message})` };
      cache.set(url, answer);
      return answer;
    }
    const state = prState(value?.state);
    if (state === null) {
      const answer = { ok: false, reason: `the gh answer names no pull request state (${JSON.stringify(value?.state)})` };
      cache.set(url, answer);
      return answer;
    }
    const oid = value?.mergeCommit?.oid;
    const mergeCommit = typeof oid === "string" && /^[0-9a-f]{7,40}$/.test(oid) ? oid : null;
    const answer = { ok: true, state, mergeCommit };
    cache.set(url, answer);
    return answer;
  };
}

/** One fetch per base branch, at most, and only when a merged dependency needs it. */
function fetcher(root, enabled) {
  const cache = new Map();
  return (baseBranch) => {
    // `--no-fetch` skips the network, not the judgement: containment is still
    // read from the refs as they are. Only a fetch that was attempted and
    // failed leaves the base unknown.
    if (!enabled) return { ok: true, skipped: true };
    if (cache.has(baseBranch)) return cache.get(baseBranch);
    const result = spawnSync("git", ["--no-optional-locks", "fetch", "origin", baseBranch], {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    let answer;
    if (result.error) {
      answer = { ok: false, reason: `git fetch could not be run (${result.error.message})` };
    } else if (result.status !== 0) {
      const detail = (result.stderr ?? "").trim();
      answer = {
        ok: false,
        reason: `git fetch origin ${baseBranch} exited ${result.status}${detail ? ` (${detail.split("\n")[0]})` : ""}`,
      };
    } else {
      answer = { ok: true };
    }
    cache.set(baseBranch, answer);
    return answer;
  };
}

/** The dependency ids on a record, as strings. */
function dependencyIds(record) {
  const ids = record?.depends_on;
  return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
}

/**
 * Resolve one dependency to the fact that decides eligibility.
 *
 * A dependency is satisfied only when its pull request reads MERGED and its
 * merge commit is an ancestor of the LOCAL base branch -- the branch the job's
 * worktree is created from. `origin/<base_branch>` is reported beside it so a
 * stale local base is distinguishable from a merge that did not land.
 */
function resolveDependency(id, { rowsById, readPr, fetchBase, root }) {
  const row = rowsById.get(id);
  if (!row) {
    return {
      id, state: "missing", pr_url: null, merge_commit: null,
      base_contains: null, origin_contains: null,
      reason: `the dependency \`${id}\` names no job record`,
    };
  }
  if (row.record !== "ok") {
    return {
      id, state: "unresolved", pr_url: null, merge_commit: null,
      base_contains: null, origin_contains: null,
      reason: `the dependency \`${id}\` has no readable job record (${row.reason})`,
    };
  }
  const prUrl = row.value?.handoff?.pr_url;
  if (typeof prUrl !== "string" || prUrl.trim().length === 0) {
    return {
      id, state: "no-pr", pr_url: null, merge_commit: null,
      base_contains: null, origin_contains: null,
      reason: `it has no pull request yet (stage \`${row.value?.stage}\`)`,
    };
  }

  const pr = readPr(prUrl);
  if (!pr.ok) {
    return {
      id, state: "unreadable", pr_url: prUrl, merge_commit: null,
      base_contains: null, origin_contains: null,
      reason: `its pull request could not be read (${pr.reason})`,
    };
  }

  const base = { id, pr_url: prUrl, merge_commit: pr.mergeCommit, base_contains: null, origin_contains: null };
  if (pr.state === "open") {
    return { ...base, state: "waiting", reason: "the pull request is open" };
  }
  if (pr.state === "closed") {
    return {
      ...base,
      state: "closed",
      reason: "its pull request is closed and will never merge; clear the id from `depends_on`",
    };
  }

  // Merged. The base has to contain the merge commit, not merely be older than
  // a branch tip: a squash merge rewrites the commit.
  const baseBranch = row.value?.base_branch ?? "main";
  const fetched = fetchBase(baseBranch);
  if (!fetched.ok) {
    return {
      ...base,
      state: "fetch-failed",
      reason: `fetching \`origin/${baseBranch}\` failed (${fetched.reason})`,
    };
  }
  if (base.merge_commit === null) {
    return {
      ...base,
      state: "unresolved",
      reason: "its merged pull request records no merge commit",
    };
  }

  const local = gitRevParse(root, baseBranch);
  if (!local.ok) {
    return {
      ...base,
      state: "unresolved",
      reason: `the base branch \`${baseBranch}\` does not resolve (${local.reason})`,
    };
  }
  const origin = gitRevParse(root, `refs/remotes/origin/${baseBranch}`);

  const inLocal = gitIsAncestor(root, base.merge_commit, local.sha);
  if (!inLocal.ok) {
    return {
      ...base,
      state: "unresolved",
      reason: `the merge commit \`${base.merge_commit}\` is not in this repository (${inLocal.reason})`,
    };
  }
  if (inLocal.ancestor) {
    return {
      ...base,
      state: "satisfied",
      base_contains: true,
      origin_contains: origin.ok ? true : null,
      reason: `\`${baseBranch}\` contains the merge commit`,
    };
  }

  let originContains = null;
  if (origin.ok) {
    const inOrigin = gitIsAncestor(root, base.merge_commit, origin.sha);
    originContains = inOrigin.ok ? inOrigin.ancestor : null;
  }
  const reason = originContains === true
    ? `\`origin/${baseBranch}\` contains the merge commit but the local \`${baseBranch}\` does not; fast-forward \`${baseBranch}\``
    : originContains === false
      ? `the merge commit did not land in \`origin/${baseBranch}\` either`
      : `the local \`${baseBranch}\` does not contain the merge commit and \`origin/${baseBranch}\` could not be checked`;
  return { ...base, state: "not-in-base", base_contains: false, origin_contains: originContains, reason };
}

/** The row for one job, before dependency resolution. */
function readRow(id, folder) {
  const job = openJob(folder);
  if (!job.record) {
    const reason = job.recordError?.reason ?? "the record is missing";
    return {
      id,
      record: "unreadable",
      reason: `the record cannot be read (${reason})`,
      stage: null, round: null, retries_left: null, branch: null,
      artifacts: [], pr: null, dependencies: [], depends_on: [],
      eligible: false, action: "inspect",
    };
  }
  const record = job.record;
  const artifacts = stageArtifacts({ record, round: job.round })
    .map((path) => ({ path, present: job.has(path) }));
  return {
    id,
    record: "ok",
    reason: null,
    stage: record.stage ?? null,
    round: Number.isInteger(record.round) ? record.round : null,
    retries_left: Number.isInteger(record.retries_left) ? record.retries_left : null,
    branch: typeof record.branch === "string" ? record.branch : null,
    artifacts,
    pr: null,
    dependencies: [],
    depends_on: dependencyIds(record),
    eligible: false,
    action: ACTIONS[record.stage] ?? "inspect",
    value: record,
    folder,
  };
}

/**
 * Build the whole report.
 *
 * Exported so a test can ask the same questions without spawning a process;
 * the CLI is a thin shell around this function.
 */
export function buildQueue(root, { fetch = true } = {}) {
  const rows = jobFolders(root).map(({ id, folder }) => readRow(id, folder));
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const readPr = prReader();
  const fetchBase = fetcher(root, fetch);

  // Pull request state is reported for every job that recorded a handoff, not
  // only for the handed_off stage: a job parked after the handoff still has a
  // pull request a human needs to see.
  for (const row of rows) {
    const url = row.value?.handoff?.pr_url;
    if (typeof url !== "string" || url.trim().length === 0) continue;
    const pr = readPr(url);
    row.pr = pr.ok
      ? { url, state: pr.state }
      : { url, state: "unreadable", reason: pr.reason };
  }

  // Only a queued job can be claimed, so only a queued job's dependencies are
  // resolved. A building job's `depends_on` is history, not a gate.
  for (const row of rows) {
    if (row.record !== "ok" || row.stage !== "queued" || row.depends_on.length === 0) continue;
    row.dependencies = row.depends_on.map((id) =>
      resolveDependency(id, { rowsById, readPr, fetchBase, root }));
    const pending = row.dependencies.filter((dependency) => dependency.state !== "satisfied");
    row.eligible = pending.length === 0;
    row.reason = row.eligible
      ? "dependencies satisfied"
      : pending.map((dependency) => `waits on ${dependency.id}: ${dependency.reason}`).join("; ");
    if (!row.eligible) row.action = "wait";
  }
  for (const row of rows) {
    if (row.record !== "ok" || row.stage !== "queued" || row.dependencies.length > 0) continue;
    row.eligible = true;
    row.reason = "no dependencies";
    row.action = "dispatch";
  }

  const eligible = rows.filter((row) => row.eligible).map((row) => row.id);
  return {
    root,
    jobs: rows.map(({ value, folder, ...row }) => row),
    eligible,
    counts: {
      jobs: rows.length,
      queued: rows.filter((row) => row.stage === "queued").length,
      eligible: eligible.length,
    },
  };
}

/** One artifact cell: `-`, `present`, or `n/m (missing a, b)`. */
function artifactCell(artifacts) {
  if (artifacts.length === 0) return "-";
  const present = artifacts.filter((artifact) => artifact.present).length;
  if (present === artifacts.length) return `${present}/${artifacts.length}`;
  const missing = artifacts.filter((artifact) => !artifact.present).map((artifact) => artifact.path);
  return `${present}/${artifacts.length} missing ${missing.join(",")}`;
}

/** The human table. */
export function formatQueue(report) {
  const header = ["job", "stage", "round", "artifacts", "pr", "action", "reason"];
  const rows = report.jobs.map((job) => [
    job.id,
    job.stage ?? "?",
    job.round === null ? "?" : String(job.round),
    artifactCell(job.artifacts),
    job.pr?.state ?? "-",
    job.action,
    job.reason ?? "",
  ]);
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...rows.map((row) => row[index].length)));
  const line = (row) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
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
  const root = resolve(options.root);
  if (!existsSync(root)) {
    process.stderr.write(`--root must name a directory that exists; \`${options.root}\` does not\n`);
    return 2;
  }

  const report = buildQueue(root, { fetch: options.fetch });
  if (options.eligible) {
    process.stdout.write(report.eligible.length > 0 ? `${report.eligible.join("\n")}\n` : "");
  } else if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatQueue(report)}\n`);
  }
  return 0;
}

// Compare the argument vector with this module's own path: `import.meta.main`
// does not exist before Node 22.18.0, and a CLI that silently does nothing is
// a false green.
const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
