# `/factory status` — the reporting contract

`/factory status` reads `factory/jobs/` and `job.json`. It never queries Herdr
for job state. The seam that spawns agents and registers worktrees is
`reference/spawn.md`; it is not a source of truth for anything this command
reports.

## What the command reports

The command reports: id, stage, retries left, round, branch, and whether the
artifact for the current stage exists.

It reports every job in `factory/jobs/` — queued, in flight, parked at
`needs_human`, or terminal — not only the job currently being dispatched.

For a job that recorded a pull request — every `handed_off` job, and any later
job the handoff left behind — the report also includes PR state, resolved via
`gh pr view --json state` and shown as `open`, `merged`, or `closed` alongside
the stage. GitHub answers that question; the record cannot, because the pack
never merges and cannot know.

**Status reports artifact presence, not agent liveness.** The report says the
stage's artifact file is present or absent. It never claims an agent is
running, idle, or finished, because nothing it reads is an agent.

## The queue report

`tools/queue.mjs` is the report `/factory status` and `/factory dispatch` both
read. It reads every `job.json` and prints one row per job. `--json` prints the
whole report as one document, `--eligible` prints only the ids a dispatch may
claim, one per line, and `--root <repo>` names the repository when the command
is run from elsewhere. `--no-fetch` skips the network and judges containment
from the refs as they are. The tool never writes a record, claims a worktree,
or moves a stage; the one write it can make is `git fetch origin
<base_branch>`, and only when a merged dependency needs its merge commit
checked.

For a `queued` job the row carries `eligible`, `action`, `reason`, and a
`dependencies` list. A job is eligible when it has no dependencies, or when
every id in `depends_on` is `satisfied`: its pull request reads `merged` and
its merge commit is an ancestor of the local base branch. Each dependency row
names one of these states:

| state | meaning |
| --- | --- |
| `satisfied` | merged, and the local base contains the merge commit |
| `waiting` | the pull request is open |
| `no-pr` | the dependency has no pull request yet |
| `missing` | the id names no job record |
| `closed` | the pull request is closed and will never merge; clear the id |
| `unreadable` | GitHub could not answer |
| `fetch-failed` | the base could not be fetched, so containment is unknown |
| `not-in-base` | merged, but the local base lacks the merge; `reason` says whether `origin/<base_branch>` has it and to fast-forward |
| `unresolved` | the merge commit is absent from this repository, or no base branch resolves |

A dependency that is not `satisfied` keeps the job `queued`; the row's `reason`
names it. This is a report about a pull request, never a stage change: a job at
`needs_human` whose pull request reads `merged` is reported as `merged` and
left at `needs_human` for `/factory recover`. The record still decides the
stage.

## Recorded runtime state

What is shown is the recorded `runtime` block — `workspace_id`, the most recent
invocation's `stage`, `agent` and `session_id`, and `max_in_flight` — exactly as
`job.json` holds it. Status does not call Herdr to check whether a workspace is
alive, and it does not replace the recorded values with whatever a live query
would answer now. The record is the authority for job state.

Recorded state may be stale, and a stale record is reported as stale, not
silently refreshed into an authority. It is always labelled as recorded in
`job.json` at `<updated_at>`, and what is running now is outside this command's
claims.

**Jobs written before the runtime block.** A job whose `runtime` is absent still
carries the older `herdr` block with `workspace_id`, `pane_id`,
`reviewer_pane_ids` and `panes_opened_by_run`. Status reports that block under
the same label and says the job predates the runtime ledger. It never invents a
`runtime` block for it.
