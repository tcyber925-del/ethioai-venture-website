# `/factory status` — the reporting contract

`/factory status` reads `factory/jobs/` and `job.json`. It never queries Herdr
for job state. Herdr is the seam that spawns and waits (see
`reference/herdr.md`); it is not a source of truth for anything this command
reports.

## What the command reports

The command reports: id, stage, retries left, round, branch, and whether the
artifact for the current stage exists.

It reports every job in `factory/jobs/` — queued, in flight, parked at
`needs_human`, or terminal — not only the job currently being dispatched.

For a `handed_off` job the report also includes PR state, resolved via `gh pr
view --json state` and shown as `open`, `merged`, or `closed` alongside the
stage. GitHub answers that question; the record cannot, because the pack never
merges and cannot know.

**Status reports artifact presence, not agent liveness.** The report says the
stage's artifact file is present or absent. It never claims an agent is
running, idle, or finished, because nothing it reads is an agent.

## Pane state

Pane state shown is what `job.json` recorded, which may be stale. A stale pane
record is reported as stale, not silently refreshed into an authority.

Staleness needs no query: the record carries its own clock. Pane state is
always labelled as recorded in `job.json` at `<updated_at>`, and what the pane
looks like now is outside this command's claims.

What is shown is the recorded `herdr` block — `workspace_id`, `pane_id`,
`reviewer_pane_ids`, `panes_opened_by_run` — exactly as `job.json` holds it.
Status does not call Herdr to check whether a pane is alive, and it does not
replace the recorded ids with whatever Herdr would answer now. The record is
the authority for job state; a pane is a process, and a process is never
reported as a stage.
