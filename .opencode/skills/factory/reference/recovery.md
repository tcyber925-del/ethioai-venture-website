# Recovery — the designed path out of a failed stage

A failed stage resumes from persisted state or stops with a reason. This document
is what `/factory recover <job-id>` reads. It decides nothing on its own: the
command reads `job.json`, reports what it finds, preserves what must not be lost,
and routes. Every other command in the factory that touches a failing job cites
this file rather than restating it.

## What recover reads

Only persisted state: `job.json` for the stage and the recorded `worktree` and
`branch`, the recorded `runtime` block, the verdict files under the job folder,
the job's rejection log, and the review history. It reads; it never infers a
stage the record does not name.

**And the rejection log.** Every refusal by the transition writer is appended
to `rejections.log` in the job's own folder, one JSON object per line: which
job, which transition was attempted, the stage the job was in, which check
failed, the tool's own conclusion, and when. `recover` reports it — it is
usually the answer to "what happened", and a refusal that is not reported is
a failure nobody can investigate. The log is append-only: a later refusal
never overwrites an earlier one, and both are readable.

## What recover never does

**`recover` never re-dispatches.** It does not spawn a subagent and does not
re-run a stage — including the stage that failed. §17.1 is explicit that a dead
subagent is not retried, because auto-retrying against an unknown failure state
risks duplicate commits on the job branch. Keeping re-dispatch out of `recover`
excludes that harm by construction rather than by prohibition: a command that
cannot dispatch cannot duplicate a commit.

Resuming is a separate, human-gated act. `recover` reports what would come next;
a human then runs `/factory go <job-id>`, which carries the resume guarantees.

## The failures this document owns

Six of §17's twelve rows are already handled by earlier plans and are cited
here rather than restated. The twelfth — a failing learning record — is
Plan 6's. These five are the ones recovery owns:

| Failure | Required response |
| --- | --- |
| Agent crashes or session ends | Report the last completed stage and the next one; resume from `job.json`, never re-running a completed stage. |
| Workspace creation fails | Preserve repository state and mark `blocked` with the cause. |
| Scope expands | Pause and reclassify the risk tier before anything continues. |
| Base branch moves | Invalidate the approval and re-evaluate; never proceed on a stale one. |
| Merge conflict | Stop and request resolution; never force through silently. |

Already handled elsewhere: intake unclear (`intake-gate.md`), a dead or timed-out
subagent (`spawn.md`), verification failure and review blockers (the dispatch
walkthrough), retries exhausted, unwritable evidence, and stale approval
(`approval.md`).

## What recover preserves

Before routing, `recover` preserves the artifacts a human will need to decide:
the job folder as it stands, any verdict files including their first line, the
review history, the recorded `runtime` block with the session id of every
invocation this job made, and the `rejections.log` beside them. Preservation
means not destroying and not rewriting — `recover` writes no verdict file of
its own, and it never truncates the rejection log.

A job written before the runtime block still carries `herdr`; preserve that
block as it stands rather than rewriting it into a `runtime` block.

## The rejection log

Every refusal the pack's tools make leaves a line in the job's own rejection
log, at `factory/jobs/<job-id>/rejections.log`. The line names the job, the
transition that was attempted, the stage the job was in, the check that
failed, the tool's own conclusion, and the time. The log is append-only: a
later attempt adds a line and never overwrites an earlier one, and nothing
shaped like a credential is written into it.

`recover` reads it. A job that was refused a transition carries a record of
that refusal, so the diagnosis `recover` reports is not a guess about what
went wrong — it is the refusal itself, with the check that failed named.

Reading the log is not writing to it. `recover` writes nothing new on a
second run, so the idempotence rule below still holds: the same failed job
reports the same thing every time.

## Where recover routes

Exactly three destinations:

- **`needs_human`** — a decision is required and no automated route is correct.
- **`blocked`** — work cannot proceed and the cause is recorded against the job.
- **a Change Request**, when the conflict is material and needs a decision above
  this job's tier.

When a job's scope has grown, `recover` re-derives its `risk_tier` from the
actual proposed change and writes it to `job.json` **before** the job pauses at
`needs_human`. A job that outgrew an `auto` tier and continues at `auto` is
worse than one that never recovered. Reclassification never lowers a tier without
the evidence that justified the original one.

## Change Requests

A Change Request is a file:

```
factory/changes/<cr-id>.md
```

It records five things, and a Change Request missing any of them cannot be
decided:

| Field | What it records |
| --- | --- |
| **Job** | the job id, its stage, and the recorded `branch` and `worktree` |
| **Conflict** | what actually conflicted, as an observation, not a conclusion |
| **Preserved artifacts** | what `recover` left in place for the reader |
| **Source facts** | what the record states, quoted rather than summarised |
| **Decision needed** | the specific question a human must answer |

A proposed change belongs in a Change Request as a labelled **inference**,
kept separate from the **source facts** and **observations** its sections keep
distinguishable — a reader must be able to tell what happened from what someone
concluded should change. Resolving a Change Request is a human decision, and is
out of this document's scope.

## Founder Decisions

A Change Request is **open** until a Founder Decision exists beside it, at
`factory/changes/<cr-id>.decision.md`.

That file is **written by a human, and by no part of this pack.** The factory
writes the Change Request and never the decision; a factory that could record its
own decision could also forge one to unblock itself, and the governance would be
theatre. Spec §5's constraint is explicit — the factory never edits its own.

A Change Request with no decision file beside it is open, not abandoned and not
resolved. Open is the normal state: an undecided proposal is not a failure.

A Founder Decision records who decided, when, and what they decided — including a
decision to **reject** the proposal, which closes the Change Request just as a
decision to accept does. Only the human writes it.

## Idempotence

Running `recover` twice on the same failed job reports the same thing and writes
nothing new. A second run does not append a second diagnosis or open a second
Change Request: two records for one failure leave a reader unable to tell which is
current.
