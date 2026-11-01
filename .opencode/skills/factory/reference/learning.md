# Learning — record and propose, never govern

Learning is retrospective. It records and proposes; **it never governs.** This
document is what `/factory learn <job-id>` reads. It decides nothing: the command
reads a job folder that already exists, writes a summary of what happened, and
routes any proposal through the same Change Request channel every other part of
the factory uses.

## When a record is written

When the job's outcome is actually known:

- **`handed_off`** — the §14.3 gate passed and the pull request opened. The job
  is finished.
- **a job parked at `blocked` or `needs_human`, when a human asks for its record.**
  Neither is an outcome, and neither advances on its own. `needs_human` is a
  pause with a door: a human `/factory rework` re-grants the budget, and
  `/factory go` resumes the job through the `needs_human` → `repairing` row. A
  `blocked` job has no resume edge yet — a known gap recorded in
  `factory/changes/CR-004.md`, not a designed stop — so it is reported, not
  resumed. An automatic record written at either describes a job that may yet
  succeed, and a record that is false in a way no later reader can detect is
  worse than none.

`merged`, `rejected` and `cancelled` are in `job.schema.json`'s stage enum, in no
transition row and in no walkthrough. Nothing sets them, so this document names
no trigger for them.

A record written on request says so, and says which of the two it was.

## What learning never does

`/factory learn` **changes no job's stage.** A retrospective record advances
nothing; the job it describes is already finished or already parked.

It writes **no Founder Decision.** A decision lives in a human-only file beside
its Change Request, and no part of this pack authors one.

It edits **no canonical project instruction** — not `AGENTS.md`, not
`.factory/policies/`, not the project profile. Proposing a change to those is a
Change Request; making it is a human's.

It changes no risk policy and removes no human gate, ever, automatically.

## The record

`learning.md` in the job folder. It distils what the folder already holds rather
than collecting anything new — the job record, `spec.md`, `build.md`,
`evidence.json`, the verdict files and `decision.md` were written by other stages.

| Field | Where it comes from |
| --- | --- |
| **Job id** | `job.json` |
| **Profile version** | from the project profile |
| **Factory version** | from this pack |
| **Original request** | `job.json` `feature` |
| **Intended outcome** | `spec.md` |
| **Final outcome** | `job.json` `stage` |
| **Acceptance criteria** | met and not met, from `build.md` against `reference/intake-gate.md`'s six |
| **Verification results** | `evidence.json` |
| **Unverified areas** | checks recorded `not_run` or `blocked` |
| **Review findings** | by category and severity, from the verdict files |
| **Repair rounds** | `job.json` `round` |
| **Main failure cause** | whichever stage produced the outcome |
| **Human decisions** | and overrides, from `decision.md` |
| **Observed rework** | regression or revert, from the review history and the diff |

A field with nothing in it says so. An empty field is a fact; a missing one is a
gap, and a reader cannot tell them apart if the record omits them.

## Proposals

A candidate improvement is written as a **Change Request**, at
`factory/changes/<cr-id>.md`, with the five fields that
`reference/recovery.md` defines. The proposal is the *decision needed*.

A proposal is an **inference**, labelled as one and kept separate from the
**source facts** and **observations** the record also carries. A single failure
is a single failure: it becomes a proposal with its evidence attached, never a
rule. Nothing unverified is described as a proven improvement.


A Change Request is open until a Founder Decision at `factory/changes/<cr-id>.decision.md` exists — created by a human, never this pack. An open Change Request is the normal state; an undecided proposal is not a failure.

## Idempotence

Running `/factory learn` twice on the same job reports the same thing and writes
nothing new. One job has one record; a second run does not rewrite it and does not open
a second Change Request.