---
name: factory-openhands
description: Run the installed feature factory pack from OpenHands Cloud, where the pack's Herdr/OpenCode orchestration seam is unavailable. Use when asked to run, dispatch, continue, review or approve a factory job from OpenHands rather than from the local OpenCode harness.
---

# Factory — OpenHands adapter

This is an adapter, not a second factory. The pack is authoritative and stays
untouched. `.opencode/skills/factory/` (its `SKILL.md`, `reference/`, `schemas/`
and `tools/`) and `.factory/` are the source of truth. This adapter replaces
exactly the one thing that cannot run in OpenHands Cloud — the orchestration
seam — and calls every pack tool unchanged.

Read the pack before acting. This adapter does not restate it:

| Pack file                           | What it is                                          |
| ----------------------------------- | --------------------------------------------------- |
| `.opencode/skills/factory/SKILL.md` | The commands, the intake gate, the dispatch loop    |
| `reference/state-machine.md`        | Stages and the transition table (canonical)         |
| `reference/spawn.md`                | The seam this adapter substitutes                   |
| `reference/permissions.md`          | The agent fences this adapter maps                  |
| `reference/isolation.md`            | Worktree layout and user-work protection            |
| `reference/fast-gate.md`            | Fast/full gate rules                                |
| `reference/approval.md`             | Change identity, preconditions, the guarded handoff |
| `reference/intake.md`               | Polling, eligibility, untrusted input               |

## Why an adapter exists

`reference/spawn.md` defines the seam: worktrees are created by
`herdr worktree create`, agents are launched as OpenCode subagents, and the run
is gated on `HERDR_ENV=1` and a live Herdr socket. OpenHands Cloud provides none
of that.

The pack's record layer is different: `tools/queue.mjs`, `tools/validate.mjs`,
`tools/transition.mjs` and `tools/handoff.mjs` are plain Node with no Herdr or
OpenCode import. They run here unmodified. So the seam is the only thing to
replace — never the stages, the job schema, the gates, the invariants, or the
approval preconditions.

## The seam substitution

| Pack (local OpenCode)                                                                                                          | Here (OpenHands Cloud)                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `herdr worktree create --cwd <main> --base <base> --branch factory/<id> --path ../<repo>-factory/<id> --label <id> --no-focus` | `git worktree add -b factory/<id> ../<repo>-factory/<id> <base>`      |
| `HERDR_ENV=1`, `herdr` on `PATH`, live socket                                                                                  | Not required — the `git` command above is the whole seam              |
| Agents launched as OpenCode subagents                                                                                          | Agents launched as OpenHands subagents (`task`)                       |
| `runtime.workspace_id` returned by Herdr                                                                                       | `null` — there is no workspace registry; the field stays schema-valid |
| Fences via OpenCode `permissions:` frontmatter                                                                                 | Tool scope per subagent type (below)                                  |

The `git worktree` command is equivalent because Herdr's only additions are the
workspace registration and the label, and no pack tool reads either — they are
recorded in `job.json`'s `runtime` block, not consumed. The path and branch
layout is `isolation.md`'s, unchanged: worktrees live at
`../<repo>-factory/<job-id>/` and survive until a terminal stage.

## Agent mapping

Each pack agent writes exactly one artifact, and only through the pack's own
tools where a tool exists.

| Pack agent          | OpenHands subagent | Its one artifact                             |
| ------------------- | ------------------ | -------------------------------------------- |
| `spec-writer`       | `general-purpose`  | `<job>/spec.md`                              |
| `builder`           | `general-purpose`  | `<job>/build.md`, and source in the worktree |
| `reviewer-code`     | `code-explorer`    | `<job>/round-<N>/review-code.md`             |
| `reviewer-security` | `code-explorer`    | `<job>/round-<N>/review-security.md`         |
| `reviewer-scope`    | `code-explorer`    | `<job>/round-<N>/review-scope.md`            |
| `reviewer-visual`   | `code-explorer`    | `<job>/round-<N>/review-visual.md`           |
| `approver`          | `general-purpose`  | `<job>/decision.md`                          |

The orchestrator writes `evidence.json` (by running the gate itself) and writes
`job.json` **only** through `tools/transition.mjs`. Never edit the record by
hand.

Scope the prompt, not just the table. Each subagent is told its one artifact and
that everything else — source, `job.json`, another role's artifact — is
read-only. That instruction is the only thing holding the boundary here; the
next section says why, and what still catches a breach.

Record every spawn. `spawn.md` requires one `runtime.invocations` entry per
subagent, written at spawn time, and INV-03 rejects a claimed reviewer verdict
whose agent has no recorded session — and a `decision.md` with no recorded
approver invocation. A run that skips this fails validation at `reviewing`:

```bash
node .opencode/skills/factory/tools/transition.mjs --job factory/jobs/<job-id> \
  --set-fields \
  --append 'runtime.invocations={"stage":"reviewing","agent":"reviewer-code","session_id":"<id>","launched_at":"<ISO-8601>","outcome":"running"}'
```

The `agent` value must be the pack agent name (`reviewer-code`, `reviewer-security`,
`reviewer-scope`, `reviewer-visual`, `approver`, `spec-writer`, `builder`), not
the OpenHands subagent type — INV-03 matches on the pack name. Set `outcome` to
`running` at spawn and update that same entry when the session ends, by index
(`--set 'runtime.invocations.0.outcome=completed'`); INV-03 rejects two
reviewers that share a `session_id`, so give each its own.

## Known limitation — the fence is weaker here

`reference/permissions.md` enforces its deny-all fence in the engine: a
read-only agent cannot write or shell out because the engine denies it. The
OpenHands subagent types have no equivalent declarative fence — `code-explorer`
and `general-purpose` both hold a shell, and neither can be restricted to a
single writable path. So the six read-only agents are fenced by **instruction**,
not by enforcement.

This is the same shape of gap `permissions.md` already documents for `builder`:
"the base policy grants it, and only the model declines to use it." The risk is
concrete: a prompt-injected subagent could modify source, `job.json`, or another
role's artifact. Three things bound that risk, and none of them is the fence:

1. **The prompt names the single artifact the agent may write** and states that
   every other path is read-only.
2. **Completion is decided by reading the artifact**, never by an invocation
   returning (`spawn.md` §Waiting is not proof).
3. **The pack's own gates still have to pass.** A subagent that writes source
   outside its scope still faces `building>verifying`, which refuses a change
   touching a protected path, and the handoff, which re-verifies the policy
   binding and all six §14.2 preconditions before it pushes.

If a job touches `high_risk_areas` or a protected path, or the operator cannot
accept instruction-only fencing for a given job, **do not dispatch it here** —
park it at `needs_human` and route it to a human-gated path. Do not claim the
fence is enforced. It is not.

## Running a job

Inspect first, then claim, then create the worktree — the order `isolation.md`
and `SKILL.md` step 2 require. The claim is the `mkdir`; it must come before the
worktree so a concurrent dispatch cannot take the same job.

```bash
git status --porcelain                      # inspect; a dirty tree does not block
git rev-parse main                          # base_commit for the record

mkdir factory/jobs/<job-id>                 # claim. NO -p: it must be able to fail
git worktree add -b factory/<job-id> ../ethioai-venture-website-factory/<job-id> main
```

Write the record through the one writer. `--create` writes the **first** record
only, at `stage: "queued"` — it refuses a folder that already holds one, so a job
that already has `job.json` is advanced, never re-created:

```bash
node .opencode/skills/factory/tools/transition.mjs \
  --job factory/jobs/<job-id> --create --record '<job.json>'

# the claim, which binds the profile's effective protected_paths to the job
node .opencode/skills/factory/tools/transition.mjs \
  --job factory/jobs/<job-id> --to planning
```

Set the two roots once, so a `cd` into the worktree cannot redirect the
record, validate or handoff commands at the main checkout:

```bash
MAIN_ROOT=$(git rev-parse --show-toplevel)      # the main checkout
JOB_DIR="$MAIN_ROOT/factory/jobs/<job-id>"      # the record lives here
```

A fresh worktree has no `node_modules`. Run the profile's `setup_command` and
every gate **inside the worktree**, in a subshell so the shell's own directory
never changes (`isolation.md`: "a fresh checkout has no `node_modules`, no
generated types, no `.env`"):

```bash
( cd ../ethioai-venture-website-factory/<job-id> &&
  TMPDIR=$PWD/.tmp npm_config_cache=$PWD/.tmp/npm npm ci )
```

Fast gate every build round — one `&&` chain, as `reference/fast-gate.md`
defines it, so a failure stops the rest. Run it in the worktree subshell:

```bash
( cd ../ethioai-venture-website-factory/<job-id> &&
  TMPDIR=$PWD/.tmp npm_config_cache=$PWD/.tmp/npm npm run format:check && \
  TMPDIR=$PWD/.tmp npm_config_cache=$PWD/.tmp/npm npm run lint && \
  TMPDIR=$PWD/.tmp npm_config_cache=$PWD/.tmp/npm npm run typecheck && \
  TMPDIR=$PWD/.tmp npm_config_cache=$PWD/.tmp/npm npm test )
```

Never invoke an individual `check:*` script: each reads `dist/`, and without a
preceding build it passes against yesterday's build (`reference/fast-gate.md`).

A gate that only runs is not evidence. The validator requires a schema-shaped
`evidence.json` (at least one check, each with `check`, `category`, `command`,
`cwd`, `diff_ref`, `started_at`, `ended_at`, `result`) before the job may leave
`verifying`. Write it from the gate's real exit status — capture the status in
the same block that runs the gate, never hand-write `passed`:

```bash
( cd ../ethioai-venture-website-factory/<job-id> &&
  TMPDIR=$PWD/.tmp npm_config_cache=$PWD/.tmp/npm npm run format:check ) \
  && FAST=0 || FAST=$?
cat > "$JOB_DIR/evidence.json" <<EOF
{"job_id":"<job-id>","diff_ref":"$(git -C ../ethioai-venture-website-factory/<job-id> rev-parse HEAD)",
 "checks":[{"check":"format:check","category":"format","command":"npm run format:check",
   "cwd":"../ethioai-venture-website-factory/<job-id>","diff_ref":"$(git -C ../ethioai-venture-website-factory/<job-id> rev-parse HEAD)",
   "started_at":"…","ended_at":"…","exit_status":$FAST,
   "result":"$([ "$FAST" = 0 ] && echo passed || echo failed)"}]}
EOF
```

A failing check means `verifying>repairing` while retries remain, or
`verifying>needs_human` — never a handoff.

## Approval and handoff

The full gate is the last thing before handoff, and it must be recorded. Capture
its real exit status and record `passed` only when it is `0`; a failed gate is
`failed` or `blocked`, and `handoff.mjs` trusts the record rather than rerunning
the gate, so a wrong value ships a broken change:

```bash
( cd ../ethioai-venture-website-factory/<job-id> &&
  TMPDIR=$PWD/.tmp npm_config_cache=$PWD/.tmp/npm npm run verify ) \
  && FULL=0 || FULL=$?
node "$MAIN_ROOT/.opencode/skills/factory/tools/transition.mjs" --job "$JOB_DIR" \
  --set-fields \
  --set "full_gate={\"command\":\"npm run verify\",\"exit_status\":$FULL,\"result\":\"$([ "$FULL" = 0 ] && echo passed || echo failed)\"}"
```

If `$FULL` is non-zero, stop — do not reach for the handoff.

Only a human may approve. Bind the approval to the exact commit, then advance
the stage; `handoff.mjs` requires `approved_to_merge` and refuses any other:

```bash
node "$MAIN_ROOT/.opencode/skills/factory/tools/transition.mjs" --job "$JOB_DIR" \
  --set-fields \
  --set 'approval={"approved":true,"diff_ref":"<approved-commit>","at":"<ISO-8601>"}'
node "$MAIN_ROOT/.opencode/skills/factory/tools/transition.mjs" --job "$JOB_DIR" \
  --to approved_to_merge
```

Before the handoff, let the pack's tools decide. Both read the record, so run
them from `$MAIN_ROOT`:

```bash
node "$MAIN_ROOT/.opencode/skills/factory/tools/validate.mjs" --job "$JOB_DIR" --all --to approved_to_merge
node "$MAIN_ROOT/.opencode/skills/factory/tools/handoff.mjs" --job "$JOB_DIR"
```

Exit codes differ by tool. `validate.mjs` and `transition.mjs` share `0` permit,
`1` reject, `2` inconclusive, `3` usage error. `handoff.mjs` shares `0`–`3` and
adds **`4` — the side effect failed**: the push or the pull request did not go
through. Code `4` is not a usage error; route it to `/factory recover`, not to a
retry, because the branch may already be pushed. A non-zero exit is never a pass.
`handoff.mjs` pushes the job branch and opens the pull request; it never merges.

Clean up a finished worktree (`isolation.md` §Cleanup — `needs_human` preserves
its worktree, only a merged or cancelled job removes one):

```bash
git worktree remove ../ethioai-venture-website-factory/<job-id>
git branch -d factory/<job-id>
```

## Preconditions that do not apply here

`spawn.md` checks four preconditions before claiming work. Three are Herdr- or
OpenCode-specific and have no meaning in OpenHands Cloud, so they are not
checked:

- `HERDR_ENV=1`
- `herdr` on `PATH` with a live socket
- the seven pack agents launchable as OpenCode subagents

The fourth — `external_directory` not `ask` — is OpenCode's prompt policy. It
does not apply either, because a worktree under `../` is reachable from the main
checkout here without a prompt.

The one precondition that does carry over is a clean read of the record: run
`node .opencode/skills/factory/tools/queue.mjs --root "$PWD" --json` and claim
only jobs it lists as `eligible`.

## What this adapter does not do

- It does not modify `.opencode/`, `.factory/policies/**` or the pack's
  `reference/` documents. Those belong to the local OpenCode harness.
- It does not install Herdr or OpenCode, and does not merge anything.
- It does not duplicate the pack. When the pack changes, this adapter changes
  only if the seam changes.
