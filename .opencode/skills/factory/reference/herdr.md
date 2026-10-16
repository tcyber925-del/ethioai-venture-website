# Herdr — the orchestrator's single seam

Herdr spawns and waits. **It decides nothing.** Verdicts come from files,
verification runs independently, and the pack never merges. Every command in the
factory that touches a pane goes through this document. The only other `herdr`
command in the pack is the worktree-create line, quoted from the block below
into `reference/isolation.md` and into the walkthrough so the step that creates
the worktree still runs the seam's own command. Replacing Herdr means replacing
this file and those quoted copies.

## Preconditions

Checked **before any job is claimed**:

- `HERDR_ENV=1`
- `herdr` on `PATH`
- the socket answers

A failure here stops the run without claiming work. Do **not** set a job to
`blocked`: `blocked` means work started and stalled, and a job that was never
claimed has nothing to preserve. Leave it `queued`.

## The commands

```bash
# one worktree per job, registered as a Herdr workspace
herdr worktree create --branch factory/<job-id> --path <path> --label <job-id> --no-focus

# one pane per agent invocation, created and closed around it
herdr pane split --current --direction down --no-focus
herdr pane run <pane-id> opencode
herdr agent wait <pane-id> --until idle --timeout 30000
herdr agent prompt <pane-id> "<stage prompt>" --wait --until done --timeout 1800000
herdr pane read <pane-id> --source recent-unwrapped --lines 120
herdr pane close <pane-id>
```

`--no-focus` everywhere. The human's focus is theirs.

## Identity

Parse every ID out of the JSON response that returns it. Never derive an ID
from sidebar order, from pane position, or from "the pane I just created". A
pane ID that did not arrive in a response is not an ID.

## Waiting is not proof

`herdr agent prompt --wait` **does not track turns**: if the agent is already
working, that active turn's completion may match. A successful `--wait` tells
you the pane has gone quiet. It does not tell you the stage finished, and it
does not tell you it was the stage you submitted.

The same call has three non-success outcomes that must not be collapsed into
one "failed":

- `agent_blocked` — the pane's agent was already blocked, so **no input was
  sent**. The stage never ran.
- `agent_prompt_stalled` — an accepted submission never reached `working`
  within 5000 ms.
- `timeout` — your timeout expired first.

**Decide completion by reading the artifact, never by reading Herdr.** After
every wait, the orchestrator reads the file that stage was required to write and
checks its first line. A quiet pane with no artifact is a failure, and a
`done` from a previous turn with no artifact is the same failure.

## Pane budget

A job in flight holds **five panes**: one stage agent, plus four reviewers in
the review round. At concurrency 2 that is at most ten. The run keeps count:
`panes_opened_by_run` in `job.json`'s `herdr` block records how many panes this
run has opened, so the ten-pane bound is checked against the record rather than
remembered. If a sixth pane would be needed, stop rather than exceed the budget —
an unbounded pane count is how a local multiplexer becomes the thing that takes
the machine down.

## Recording

Write every parsed id into `job.json`'s `herdr` block as the response returns
it — `workspace_id` from the create, `pane_id` for the stage agent,
`reviewer_pane_ids` for each reviewer — and increment `panes_opened_by_run`
for every pane opened. Without this write the block stays empty, and a rule
that reads it has nothing to read.

## What gets closed

Only panes this run created, and only on a terminal stage. A pane recorded in
`job.json` under `herdr` belongs to a job, not to the run that made it: closing
it during another job's dispatch would kill a live agent. Terminal stages are
`merged` and `cancelled` for removal, and `needs_human` for **preservation** —
the human needs the pane state to inspect what happened.

## Dead panes are not retried

A pane that dies mid-invocation leaves the artifact unwritten. Do not re-run
the stage. §17.1 is explicit: re-running against an unknown state risks
duplicate commits on the job branch. Set `needs_human`, preserve the worktree,
the branch and the pane record, and report it.

## Worktrees and ports

Worktrees live at `../<repo>-factory/<job-id>/` and survive until a terminal
stage. Ports derive from the job number `n`: stage agents `5100 + 10n`,
`reviewer-visual` `5101 + 10n`. Job numbers are unique, so ports stay unique.
