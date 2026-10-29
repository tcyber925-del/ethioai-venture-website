# State machine

The single source of truth for job state. The orchestrator owns `job.json` and
changes `stage` only via a row in the table below.

## Stages

`intake` · `needs_clarification` · `planning` · `awaiting_plan_approval` ·
`building` · `verifying` · `repairing` · `reviewing` ·
`awaiting_human_review` · `approved_to_merge` · `handed_off` · `merged` ·
`queued` · `blocked` · `needs_human` · `rejected` · `cancelled`

Terminal: `merged`, `blocked`, `needs_human`, `rejected`, `cancelled`.

## Transitions

| From | To | Trigger |
| --- | --- | --- |
| `intake` | `needs_clarification` | an intake acceptance criterion (§8.3) is unmet |
| `intake` | `queued` | all six acceptance criteria hold |
| `needs_clarification` | `queued` | the human answers the focused question |
| `queued` | `planning` | `/factory dispatch` claims the job |
| `planning` | `blocked` | Herdr workspace creation fails — repository state preserved, cause recorded in `job.json`'s `cause` |
| `planning` | `awaiting_plan_approval` | tier is `approval` and `spec.md` exists |
| `planning` | `building` | `spec.md` exists, and either the tier is not `approval` or `/factory go` recorded `spec_approved` |
| `awaiting_plan_approval` | `building` | `/factory go <job-id>` records `spec_approved` |
| `building` | `verifying` | `build.md` first line is `STATUS: READY`, the worktree is clean, `HEAD` is the job branch's own commit, and no changed path matches the profile's effective `protected_paths` bound at claim (always including `.factory/profile.md` and `.factory/policies/**`) |
| `building` | `needs_human` | `build.md` first line is `STATUS: BLOCKED` |
| `verifying` | `repairing` | a check failed and `retries_left` remains |
| `verifying` | `reviewing` | every check is `passed` or `not_applicable` |
| `verifying` | `needs_human` | a check is `blocked` or `not_run`, or retries are exhausted |
| `verifying` | `blocked` | evidence could not be written — cause recorded in `job.json`'s `cause` |
| `repairing` | `building` | the orchestrator re-dispatches the builder with the failing check's output |
| `reviewing` | `awaiting_human_review` | all four verdict files exist, the record's `reviews` claim exactly them (`tools/transition.mjs --sync`), none carries a blocking finding, and `decision.md` says APPROVE |
| `reviewing` | `repairing` | any verdict carries a blocking finding and `retries_left` remains |
| `reviewing` | `needs_human` | blocking findings remain and `retries_left` is exhausted, or `decision.md` says ESCALATE |
| `awaiting_human_review` | `approved_to_merge` | `/factory approve <job-id>` records explicit human approval naming this job, bound to the current `diff_ref` — the change identity, `reference/approval.md` — with every §14.2 precondition holding |
| `awaiting_human_review` | `reviewing` | the approved `diff_ref` no longer matches the current diff — approval is stale (§12.4), the change identity of `reference/approval.md` |
| `approved_to_merge` | `handed_off` | the full gate passes and the pull request is opened (§14.3) |
| `approved_to_merge` | `awaiting_human_review` | a §14.2 precondition fails at handoff; the approval is cleared |

## Coverage of this table

The table above is the complete transition set for this build. It is
deliberately not the finished state machine, and it should not be read as one.

The three `intake` rows describe states of the conversation, not writes to a
record. The intake gate runs before any `job.json` exists, so a held request
sits at `needs_clarification` in the conversation only — no file ever says
`stage: needs_clarification`, because no file exists until the criteria hold
and the job is written at `queued`. The rows stay because the machine is bigger
than this plan; they are not evidence that a record can sit at `intake`.

These stages are part of the model but have no transition rows yet:

- `merged` — never asserted by this pack; resolved by reading the pull
  request (§9.4), so no row reaches it by design
- `rejected`, `cancelled` — terminal exits with no route into them

Anyone extending the table must also update the stage lists in the same change.
The test `the reference's own stage list and terminal line stay in sync` pins
the `## Stages` list to the schema's `stage` enum, so adding a stage name to
either place without the other fails the suite. Extend deliberately.

Invariants 1, 2 and 3 govern `approved_to_merge`, `handed_off` and `merged`.
The rows that reach the first two now exist, so those three are enforced by the
transition table rather than aspirational — but only to the depth the table can
reach: it records *that* a precondition held, not *whether* a human meant it.
Invariant 3 still has no row behind it, because `merged` is resolved by reading
the pull request (§9.4) and never asserted here.

Invariants 4 through 8 govern edges this plan traverses, and some of them are
now machinery as well as prose: the transition writer enforces the fourth (a
failed stage stops safely, and the main checkout's guard refuses a write over
user work) and the fifth (an exhausted budget never becomes success), and the
validator enforces the sixth and the eighth. A test can pin that a document
*states* an invariant; it cannot make the orchestrator follow one — but where
a tool enforces it, the tool is the evidence. Read every invariant below as a
rule the pack commits to in writing.

## Invariants

1. A job never enters `approved_to_merge` without complete verification evidence.
2. A job never enters `handed_off` without explicit human approval naming that job and that diff.
3. A job is never reported `merged` without confirming the merge completed via `gh pr view`.
4. A failed or interrupted stage resumes from persisted state or stops safely; it never restarts in a way that overwrites user work.
5. Exhausted retries transition to `blocked` or `needs_human`, never to success.
6. A moved base branch, a merge conflict, or a stale approval invalidates the pending handoff.
7. Terminal jobs remain inspectable, with their artifacts and decisions intact.
8. No skill, agent, or status view reports a state the persisted record does not support.

## Retry budget

A human rework (`/factory rework`) is the one thing that resets the budget: it
sets `retries_left` to the profile's budget and stamps `retry_budget_reset_at`,
and a budget a human granted is the human's to grant. Nothing else may.

`retries_left` starts at **2** and is **shared** across verification failures
and review `CHANGES` verdicts — the loop cannot spin, and cannot re-roll the
dice by failing a different way. The orchestrator decrements it by one —
together with incrementing `round` by one, in the same write to `job.json`
that sets `stage: "repairing"` — whether the job arrived there from
`verifying` or from `reviewing`. `repairing` is the single funnel both failure
sources pass through, which is why the budget cannot be re-rolled by failing a
different way. It resets only on explicit human `/factory rework`.
