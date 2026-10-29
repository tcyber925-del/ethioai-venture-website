# Spawning — the orchestrator's single seam

Agents are OpenCode subagents. **The seam decides nothing.** Verdicts come from
files, verification runs independently, and the pack never merges. Every command
in the factory that spawns an agent or registers a worktree goes through this
document.

Herdr is invoked exactly once, for the worktree registration quoted below into
`reference/isolation.md` and into the walkthrough. Replacing Herdr means
replacing this file and those two quoted copies.

## Herdr's own guidance

Herdr ships an agent skill for its CLI; it lives in the operator's agent
configuration, not in this pack. Reach for it on two branches: reading flag
syntax, and making sense of a failed Herdr command. The installed binary is the
authority on both — `herdr --help` and the command group print the current
syntax.

Read that skill as a CLI reference. The seam is this document: the factory makes
one Herdr invocation, quoted in `## Worktrees and ports`, and the skill's wider
model of running agents in a terminal belongs to other workflows. Here, agents
are native subagents, the artifact on disk is the proof a stage ran, and
`job.json` is authoritative for state.

## Preconditions

Checked **before any job is claimed**:

- `HERDR_ENV=1`
- `herdr` on `PATH`, and the socket answers — worktree registration needs it
- the seven pack agents are launchable as subagents by the orchestrator —
  `reference/permissions.md` clause 5 declares the seven grants, one per agent
  id, and an id outside them matches no rule. Clause 5 is the declaration, not
  the installation: the grants live in the operator's own config and the pack
  installs none of them, which is why this is checked here and not assumed. So a
  config that narrows `subagent` fails here, named, rather than stalling the
  first wave with nothing declared.
- `external_directory` is not `ask` — OpenCode's default policy allows it, so
  reaching the worktree from the main checkout fires no prompt, and a target repo
  that asks instead is a stated failure here rather than a hang nobody sees

A failure here stops the run without claiming work. Do **not** set a job to
`blocked`: `blocked` means work started and stalled, and a job that was never
claimed has nothing to preserve. Leave it `queued`.

## Spawning

One subagent per agent invocation. Nothing is opened, and nothing is closed:

```text
agent   = <spec-writer | builder | reviewer-code | reviewer-security
          | reviewer-scope | reviewer-visual | approver>
prompt  = the stage prompt: absolute job folder, absolute worktree, branch,
          round, and the stage's inputs
result  = a session id, written to job.json at launch
```

Run the invocation in the background whenever more than one invocation of that
stage is in flight, and in the foreground when it is the only one.

## Two paths, one author each

A subagent inherits the orchestrator's working directory, which is the target
repository's main checkout. So the prompt states the split as a rule:

> Your artifact is `<job folder>/<artifact>`. Your code changes are in
> `<worktree>`. Nothing else is writable to you.

Each file has exactly one author: `spec-writer` writes `spec.md`; `builder`
writes `build.md`; `reviewer-<role>` writes `round-<N>/review-<role>.md`; the
transition tool writes `job.json`; the orchestrator writes `evidence.json`.
The worktree holds only source and the job branch.

## The orchestrator's write surface

The orchestrator writes `evidence.json` and nothing else. `job.json` it
writes only through `tools/transition.mjs`, the pack's one writer of the
record, which the orchestrator invokes.

The tool takes an exclusive lock beside the record, checks the transition
against the record as it read it, and renames the new record into place, so two
writers of one record cannot overwrite each other and a reader never sees half
of one. The guarded protected action records its own outcome through the same
tool, so there is one lock and one atomic write behind every change to
`job.json`.

`evidence.json` the orchestrator writes itself, by running the profile's gate.
It does not write a spec, a build report, a verdict file or `learning.md`,
and it does not edit source.

Queue pressure is relieved by waiting for a slot, never by doing a stage
inline. Running the profile's `fast_gate` and `full_gate` is not a violation:
the orchestrator runs verification because it is the evidence authority, and
that is the only reason it holds `shell`.

## Waiting is not proof

A subagent that returns has gone quiet, which is not the same as having
finished the stage that was submitted. **Completion is decided by reading the
artifact, never by the invocation returning.**

After every invocation, read the file that stage was required to write and check
its first line. There are two failure cases:

- the invocation errored, or its session died
- the invocation returned and the artifact is missing or its first line is
  malformed

## The in-flight cap

At most six subagents are in flight across the whole run, so the bound is
checked against the record rather than remembered: `max_in_flight` in
`job.json`'s `runtime` block holds the high-water mark this run reached. When a
stage wants more invocations than the cap allows, launch what fits, queue the
rest, and launch as results land.

## Recording

Write every spawned session id into `job.json`'s `runtime` block — through
`tools/transition.mjs`, the pack's only writer of the record — **at launch,
never when the session ends** — one entry in `invocations` per spawn, carrying
`stage`, `agent`, `session_id`, `launched_at` and `outcome` (`running` until the
session ends, then the outcome it ended with), plus the `workspace_id` the
worktree registration returned and `max_in_flight` for the run's high-water
mark. Without this write the block stays empty, and a rule that reads it has
nothing to read — and a write held back to the return loses every session that
never returns, which is the one §Dead subagents tells you to record.

## Dead subagents are not retried

A session that dies without writing its artifact leaves the artifact unwritten.
It is **not retried**: do not re-run the stage, because re-running against an
unknown state risks duplicate commits on the job branch. Set `needs_human`,
record the session id, preserve the worktree and the branch, and report it.

## Worktrees and ports

Worktrees live at `../<repo>-factory/<job-id>/` and survive until a terminal
stage:

```bash
herdr worktree create --cwd <absolute path to the main checkout> --base <base_branch> --branch factory/<job-id> --path ../<repo>-factory/<job-id> --label <job-id> --no-focus
```

A job that serves a UI is given a port: `5101 + 10n`, where `n` is the job
number. Job numbers are unique, so ports stay unique. (The pack's visual
reviewer does not use it — its fence denies every action but the reads and its
own verdict — so the port is reserved rather than consumed.
`permissions.md` says what the visual reviewer can and cannot do.)