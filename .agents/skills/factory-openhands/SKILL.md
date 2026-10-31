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

## Known limitation — the fence is weaker here

`reference/permissions.md` enforces its deny-all fence in the engine: a
read-only agent cannot write or shell out because the engine denies it. The
OpenHands subagent types have no equivalent declarative fence — `code-explorer`
and `general-purpose` both hold a shell. So the six read-only agents are fenced
by **instruction**, not by enforcement.

This is the same shape of gap `permissions.md` already documents for `builder`:
"the base policy grants it, and only the model declines to use it." Two
mitigations keep the boundary meaningful:

1. The prompt names the single artifact the agent may write, and states that
   every other path is read-only.
2. The orchestrator never trusts the agent's report — completion is decided by
   reading the artifact (`spawn.md` §Waiting is not proof), and the transition
   tool refuses any transition whose row trigger is not satisfied: an artifact a
   trigger presupposes, and that is missing, makes the trigger false. The
   invariant sweep is a separate call — `validate.mjs --all --to <stage>` — and
   its `reject` is a stop, not a soft pass.

Do not claim the fence is enforced. It is not.

## Running a job

Set up once, in the main checkout:

```bash
TMPDIR=$PWD/.tmp npm_config_cache=$PWD/.tmp/npm npm ci
```

Claim a job and create its worktree (`isolation.md`'s order: inspect, then
create):

```bash
git status --porcelain                      # inspect; a dirty tree does not block
git rev-parse main                          # base_commit for the record
git worktree add -b factory/<job-id> ../ethioai-venture-website-factory/<job-id> main
```

Create the record through the one writer:

```bash
node .opencode/skills/factory/tools/transition.mjs \
  --job factory/jobs/<job-id> --create --record '<job.json>'
```

Fast gate every build round, full gate once before handoff, both from the
worktree and both with the temp prefix:

```bash
TMPDIR=$PWD/.tmp npm_config_cache=$PWD/.tmp/npm npm run format:check
TMPDIR=$PWD/.tmp npm_config_cache=$PWD/.tmp/npm npm run lint
TMPDIR=$PWD/.tmp npm_config_cache=$PWD/.tmp/npm npm run typecheck
TMPDIR=$PWD/.tmp npm_config_cache=$PWD/.tmp/npm npm test
TMPDIR=$PWD/.tmp npm_config_cache=$PWD/.tmp/npm npm run verify
```

Never invoke an individual `check:*` script: each reads `dist/`, and without a
preceding build it passes against yesterday's build (`reference/fast-gate.md`).

Before a protected transition, and before the handoff, let the pack's tools
decide:

```bash
node .opencode/skills/factory/tools/validate.mjs --job factory/jobs/<job-id> --all --to <stage>
node .opencode/skills/factory/tools/handoff.mjs --job factory/jobs/<job-id>
```

The exit code is the answer: `0` permit, `1` reject, `2` inconclusive,
`3` usage error. A non-zero exit is never a pass. `handoff.mjs` pushes the job
branch and opens the pull request; it never merges.

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
