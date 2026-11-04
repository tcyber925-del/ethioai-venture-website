/**
 * ENG-123 / CR-010 Option A — regression battery for the rework guard in
 * `.opencode/skills/factory/tools/transition.mjs`, the pack's ONE writer of
 * `job.json`.
 *
 * A rework that carries an explicit human-request marker (`--rework-requested`)
 * stamps `retry_budget_reset_at` on a budget that still has retries left,
 * without raising it (REWORK_BUDGET_RAISED); without the marker the writer
 * refuses exactly as before (REWORK_BUDGET_LEFT), and an exhausted budget
 * restores exactly as before. Everything else about the writer is pinned too:
 * the marker is inert outside a budget write, the `needs_human` → `repairing`
 * row still demands the stamp and a remaining retry spent in one write, and
 * SKILL.md's own commands still describe the implemented rule.
 *
 * Every fixture is a disposable temp tree laid out as
 * `<tmp-root>/factory/jobs/900-rework-fixture/` with a recursive copy of
 * `.opencode/skills/factory/` at `<tmp-root>/.opencode/skills/factory/`. That
 * layout is load-bearing: `repoRootFor` then resolves the temp root, so the
 * main-checkout guard runs for real and its `factory/jobs/` allowlist covers
 * everything these tests mutate — the pack copy, `job.json`, `rejections.log`,
 * the guard's `main-checkout.txt` baseline and the `.job.lock` all live under
 * the temp root, and `--job` never points at the repository's real
 * `factory/jobs/`. The CLI is invoked with an argv array via
 * `execFileSync(process.execPath, …)`, never a shell.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const packDir = join(repoRoot, ".opencode/skills/factory");
const skillMd = join(packDir, "SKILL.md");

const FIXTURE_ID = "900-rework-fixture";
const STAMP = "2026-11-04T12:00:00.000Z";

/**
 * A minimal, schema-valid record (fixed ISO strings; the schema does not
 * enforce `format`), with the knobs the scenarios below turn.
 */
function record({ stage, retriesLeft, round, stamp }) {
  return {
    id: FIXTURE_ID,
    source: { provider: "manual", dedupe_key: "eng-123-rework-fixture" },
    feature: "Rework guard regression fixture",
    linear_id: "ENG-123",
    repo: "tcyber925-del/ethioai-venture-website",
    base_branch: "main",
    base_commit: "3503d3831be2415c0e0d5f9f61764da726e6fd6e",
    risk_tier: "approval",
    branch: "factory/ENG-123-rework-human-request",
    worktree: "../ethioai-venture-website-factory/900-rework-fixture",
    stage,
    round,
    retries_left: retriesLeft,
    reviews: {
      code: "pending",
      security: "pending",
      scope: "pending",
      visual: "pending",
    },
    approval: { approved: false, diff_ref: null },
    cause: "a check failed and a human is deciding what comes next",
    retry_budget_reset_at: stamp,
    started_at: "2026-11-04T09:00:00.000Z",
    updated_at: "2026-11-04T09:00:00.000Z",
  };
}

/**
 * One disposable job: the pack copied beside a `factory/jobs/900-…` folder
 * holding the record the scenario parks there.
 */
function fixture({
  stage = "needs_human",
  retriesLeft = 1,
  round = 0,
  stamp = null,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "transition-rework-"));
  try {
    cpSync(packDir, join(root, ".opencode/skills/factory"), {
      recursive: true,
    });
    const job = join(root, "factory/jobs", FIXTURE_ID);
    mkdirSync(job, { recursive: true });
    writeFileSync(
      join(job, "job.json"),
      `${JSON.stringify(record({ stage, retriesLeft, round, stamp }), null, 2)}\n`,
    );
    return { root, job };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/** Run the copied tool against the fixture job. Never a shell. */
function run(root, args) {
  const script = join(root, ".opencode/skills/factory/tools/transition.mjs");
  const job = join(root, "factory/jobs", FIXTURE_ID);
  try {
    const stdout = execFileSync(
      process.execPath,
      [script, "--job", job, ...args],
      {
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

/** The fixture's record, read back from disk. */
function jobRecord(f) {
  return JSON.parse(readFileSync(join(f.job, "job.json"), "utf8"));
}

/** The fixture's rejection log, parsed — one JSON object per line. */
function refusals(f) {
  return readFileSync(join(f.job, "rejections.log"), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

/** The section of a markdown document one heading introduces, house style. */
function sectionOf(markdown, heading) {
  const start = markdown.indexOf(heading);
  const rest = markdown.slice(start + heading.length);
  const next = rest.search(/\n#{1,6} /);
  return next === -1 ? rest : rest.slice(0, next);
}

test("a human-requested rework stamps a budget that still has retries left, without raising it", () => {
  const f = fixture({ stage: "needs_human", retriesLeft: 1, round: 0 });
  try {
    const result = run(f.root, [
      "--set-fields",
      "--rework-requested",
      "--set",
      `retry_budget_reset_at=${STAMP}`,
    ]);
    assert.equal(result.code, 0, result.stderr);
    const job = jobRecord(f);
    assert.equal(job.retry_budget_reset_at, STAMP);
    assert.equal(job.retries_left, 1);
    assert.equal(job.stage, "needs_human");
    assert.equal(job.round, 0);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("without the marker, stamping a remaining budget is refused as REWORK_BUDGET_LEFT and logged", () => {
  const f = fixture({ stage: "needs_human", retriesLeft: 1 });
  try {
    const result = run(f.root, [
      "--set-fields",
      "--set",
      `retry_budget_reset_at=${STAMP}`,
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /REWORK_BUDGET_LEFT/);
    const last = refusals(f).at(-1);
    assert.equal(last.failed, "REWORK_BUDGET_LEFT");
    assert.equal(last.conclusion, "refused");
    assert.equal(jobRecord(f).retry_budget_reset_at, null);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a human-requested rework that would raise the budget is refused as REWORK_BUDGET_RAISED", () => {
  const f = fixture({ stage: "needs_human", retriesLeft: 1 });
  try {
    const result = run(f.root, [
      "--set-fields",
      "--rework-requested",
      "--set",
      `retry_budget_reset_at=${STAMP}`,
      "--set",
      "retries_left=2",
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /REWORK_BUDGET_RAISED/);
    const last = refusals(f).at(-1);
    assert.equal(last.failed, "REWORK_BUDGET_RAISED");
    assert.equal(last.conclusion, "refused");
    const job = jobRecord(f);
    assert.equal(job.retry_budget_reset_at, null);
    assert.equal(job.retries_left, 1);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a budget write outside needs_human is refused as REWORK_NOT_PARKED, marker or not", () => {
  for (const reworkRequested of [false, true]) {
    const f = fixture({ stage: "verifying", retriesLeft: 1 });
    try {
      const args = ["--set-fields", "--set", `retry_budget_reset_at=${STAMP}`];
      if (reworkRequested) args.push("--rework-requested");
      const result = run(f.root, args);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /REWORK_NOT_PARKED/);
      const last = refusals(f).at(-1);
      assert.equal(last.failed, "REWORK_NOT_PARKED");
      assert.equal(last.conclusion, "refused");
      assert.equal(jobRecord(f).retry_budget_reset_at, null);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});

test("without the stamp, the resume is refused by the trigger: no human rework is recorded", () => {
  const f = fixture({ stage: "needs_human", retriesLeft: 1, round: 0 });
  try {
    const result = run(f.root, [
      "--to",
      "repairing",
      "--set",
      "retries_left=0",
      "--set",
      "round=1",
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /INV-01\/TRIGGER_FALSE/);
    assert.match(result.stderr, /no human rework is recorded/);
    const last = refusals(f).at(-1);
    assert.equal(last.failed, "INV-01/TRIGGER_FALSE");
    assert.equal(last.conclusion, "refused");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("with the stamp but a spent budget, the resume is refused: the re-granted budget is spent", () => {
  const f = fixture({
    stage: "needs_human",
    retriesLeft: 0,
    round: 0,
    stamp: STAMP,
  });
  try {
    const result = run(f.root, [
      "--to",
      "repairing",
      "--set",
      "retries_left=0",
      "--set",
      "round=1",
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /INV-01\/TRIGGER_FALSE/);
    assert.match(result.stderr, /the re-granted budget is spent/);
    const last = refusals(f).at(-1);
    assert.equal(last.failed, "INV-01/TRIGGER_FALSE");
    assert.equal(last.conclusion, "refused");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("with the stamp and a remaining retry, the resume spends one retry and one round in one write", () => {
  const f = fixture({
    stage: "needs_human",
    retriesLeft: 1,
    round: 0,
    stamp: STAMP,
  });
  try {
    const result = run(f.root, [
      "--to",
      "repairing",
      "--set",
      "retries_left=0",
      "--set",
      "round=1",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const job = jobRecord(f);
    assert.equal(job.stage, "repairing");
    assert.equal(job.retries_left, 0);
    assert.equal(job.round, 1);
    assert.equal(job.retry_budget_reset_at, STAMP);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("the resume cannot skip the spend: --to repairing without the decrement is BUDGET_NOT_SPENT", () => {
  const f = fixture({
    stage: "needs_human",
    retriesLeft: 1,
    round: 0,
    stamp: STAMP,
  });
  try {
    const result = run(f.root, ["--to", "repairing"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /BUDGET_NOT_SPENT/);
    const last = refusals(f).at(-1);
    assert.equal(last.failed, "BUDGET_NOT_SPENT");
    assert.equal(jobRecord(f).stage, "needs_human");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("an exhausted budget restores to the profile's budget exactly as before, marker optional", () => {
  const f = fixture({ stage: "needs_human", retriesLeft: 0 });
  const g = fixture({ stage: "needs_human", retriesLeft: 0 });
  try {
    const withoutMarker = run(f.root, [
      "--set-fields",
      "--set",
      "retries_left=2",
      "--set",
      `retry_budget_reset_at=${STAMP}`,
    ]);
    assert.equal(withoutMarker.code, 0, withoutMarker.stderr);
    let job = jobRecord(f);
    assert.equal(job.retries_left, 2);
    assert.equal(job.retry_budget_reset_at, STAMP);
    assert.equal(job.stage, "needs_human");

    // The same exhausted restore with the marker, against a FRESH exhausted
    // fixture, is allowed too: the exhausted branch does not require the
    // marker, and the raise check stays behind the exhausted gate -- a
    // restore from 0 to 2 must not be read as a raise.
    const withMarker = run(g.root, [
      "--set-fields",
      "--rework-requested",
      "--set",
      "retries_left=2",
      "--set",
      `retry_budget_reset_at=${STAMP}`,
    ]);
    assert.equal(withMarker.code, 0, withMarker.stderr);
    job = jobRecord(g);
    assert.equal(job.retries_left, 2);
    assert.equal(job.retry_budget_reset_at, STAMP);
    assert.equal(job.stage, "needs_human");

    // The restore above left f's record at `retries_left: 2`, so this marker
    // run sets an equal value on a remaining budget and is allowed: it pins
    // the raise check as `>` and not `>=`.
    const equalValue = run(f.root, [
      "--set-fields",
      "--rework-requested",
      "--set",
      "retries_left=2",
      "--set",
      `retry_budget_reset_at=${STAMP}`,
    ]);
    assert.equal(equalValue.code, 0, equalValue.stderr);
    job = jobRecord(f);
    assert.equal(job.retries_left, 2);
    assert.equal(job.stage, "needs_human");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
    rmSync(g.root, { recursive: true, force: true });
  }
});

test("the marker is inert without a budget field: a field write grants nothing else", () => {
  const f = fixture({ stage: "needs_human", retriesLeft: 1 });
  try {
    const result = run(f.root, [
      "--set-fields",
      "--rework-requested",
      "--set",
      "spec_approved=true",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const job = jobRecord(f);
    assert.equal(job.spec_approved, true);
    assert.equal(job.retry_budget_reset_at, null);
    assert.equal(job.retries_left, 1);
    assert.equal(job.stage, "needs_human");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("SKILL.md still describes the rule: rework names --rework-requested, go still requires the stamp and a retry", () => {
  const markdown = readFileSync(skillMd, "utf8");
  // The document wraps its prose, so the wording is matched with whitespace
  // normalised: the drift pin is about what the commands say, not the wrap.
  const rework = sectionOf(markdown, "## /factory rework").replace(/\s+/g, " ");
  assert.match(rework, /--rework-requested/);
  // The remaining budget is left unchanged by a human-requested rework.
  assert.match(rework, /leave `retries_left` exactly as it is/);
  // The resume door is unchanged: the stamp and a remaining retry.
  const go = sectionOf(markdown, "## /factory go").replace(/\s+/g, " ");
  assert.match(go, /`retry_budget_reset_at` set and `retries_left` above zero/);
});

test("--rework-requested outside --set-fields is a usage refusal, logged beside the job", () => {
  const f = fixture({ stage: "needs_human", retriesLeft: 1 });
  try {
    const result = run(f.root, ["--to", "building", "--rework-requested"]);
    assert.equal(result.code, 3);
    assert.match(result.stderr, /--rework-requested belongs to --set-fields/);
    const last = refusals(f).at(-1);
    assert.equal(last.failed, "USAGE");
    assert.equal(last.conclusion, "refused");
    assert.equal(jobRecord(f).stage, "needs_human");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
