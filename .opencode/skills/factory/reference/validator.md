# The validator

`tools/validate.mjs` is the pack's first executable check. It decides whether
a job may advance, from what is on disk right now, and it answers with exactly
one of three outcomes.

- **permit** — the inspected inputs satisfy the invariant.
- **reject** — the inspected inputs violate it, on concrete evidence.
- **inconclusive** — the validator could not decide: a required input is
  missing, unreadable or ambiguous.

**Inconclusive is never permit.** Reject and inconclusive both block protected
progress. The difference is what a human is told: a reject names a violation,
an inconclusive names a question the tool could not answer.

The validator is **read-only**. It never writes, creates, moves or deletes a
file, and it never mutates git state. It reads the job folder, reads the
pack's own references and schemas, and asks git four read-only questions
(`rev-parse`, `status --porcelain`, `merge-base --is-ancestor`,
`diff --name-only`). It has no dependencies beyond `node:` builtins, no clock,
no network and no randomness: two runs over the same inputs give the same
answer.

It does not judge code quality, does not merge, does not auto-repair, does
not re-run a failed check, and does not write anything anywhere.

## Commands

    node tools/validate.mjs --job <job-folder> --invariant <INV-01|INV-02|INV-03|INV-04> [--to <stage>] [--json]
    node tools/validate.mjs --job <job-folder> --all [--to <stage>] [--json]
    node tools/validate.mjs --help

`tools/` sits beside `reference/` and `schemas/` in the installed pack, so the
paths resolve the same way `SKILL.md` resolves `reference/…`.

| Exit | Meaning |
| --- | --- |
| `0` | permit |
| `1` | reject |
| `2` | inconclusive |
| `3` | usage error |

**A non-zero exit is never a pass.** This is the tool's own contract; it is
not the live harness's grader, which uses `0` for graded and `2` for
ungraded.

`--to <stage>` names the transition INV-01 is about. It is **required** for
INV-01 and **rejected** for the other three. With `--all` it applies to
INV-01 alone; without it, **INV-01 is not evaluated** — the report says so
(`INV-01/NOT_EVALUATED`), because a transition needs a target, and the run's
outcome is **inconclusive**: a run that did not ask the question cannot
answer it, and an unanswered question is not a pass. Run `--all --to
<stage>` before a protected transition.

Without `--json` the tool prints one line per check and then a final line
carrying the outcome on its own:

    INV-01/EDGE_IN_TABLE          permit       the transition `building` -> `verifying` is a row in `reference/state-machine.md`
    INV-01/TRIGGER_SATISFIED     permit       the trigger holds: `build.md` opens with `STATUS: READY`
    permit

With `--json` it prints a single object:

    {
      "job": "/abs/path/to/factory/jobs/001-about-faq",
      "invariant": "INV-01",
      "outcome": "permit",
      "checks": [ { "id": "INV-01/EDGE_IN_TABLE", "outcome": "permit", "detail": "…" } ],
      "reasons": []
    }

`reasons` holds the detail of every check that is not a permit — the reasons
behind the answer. It is empty when the outcome is `permit`.

The `id` of a check is its **reason code**. The codes are listed below, and
each code has exactly one outcome: no code is ever a reject in one run and an
inconclusive in another. That is the tool's vocabulary, and it is what makes a
report actionable.

## The four invariants

### INV-01 — legal state transitions

**Inspected:** the transition table in `reference/state-machine.md`, the job
folder, and the record.

The record holds no transition history, so a transition is checked as a
*proposed* transition: "may this job move from stage X to stage Y, given what
is on disk right now?" X is the record's `stage`; Y is `--to`.

The set of legal edges is **parsed from the table**, never copied into code.
The table has 24 rows. Three of them are conversational and are not
implemented (see below); the other 21 each get a predicate that reads the
row's own trigger. A row the validator has no predicate for is reported as
`INV-01/EDGE_NOT_IMPLEMENTED` — never as a permit.

A transition **into a failure stage** (`needs_human`, `blocked`) is always
permitted: failing safe must never be blocked. That applies to the rows the
table has — `building → needs_human`, `verifying → needs_human`,
`verifying → blocked`, `planning → blocked`, `reviewing → needs_human` — and
the row's own trigger is not what makes them permitted. A transition the
table does **not** have is a reject whatever it points at: the table is the
canonical set of legal edges, and `building → blocked` is not one of them.

A `blocked` job must carry a non-empty `cause`; the job schema requires it
too. A job parked at `needs_human` must carry one as well: a job waiting for a
person with no stated reason is not recoverable, it is only parked, and the
schema requires it there too.

A transition **not in the table** is a **reject**, not an inconclusive.

The transition into `verifying` also reads the profile's `protected_paths`. A
changed path that matches one is a reject (`INV-01/PROTECTED_PATH_CHANGED`) on
every tier; a profile or section that cannot be read is an inconclusive, never
a permit. The list is read from the main
checkout's `.factory/profile.md`, and the paths compared are the ones git
reports between the recorded `base_commit` and the job branch's `HEAD`.

The effective policy always adds `.factory/profile.md` and
`.factory/policies/**`, even when the profile says `none`. The floor has no
opt-out: the job cannot change the profile or a policy file it is judged by.

The comparison is against the policy the job **bound at claim** (`queued ->
planning` writes it into the record), so a `protected_paths` that moved after
the claim is inconclusive rather than read fresh, and a job with no binding
(never claimed, or claimed before bindings existed) cannot be judged. A
binding that omits the floor is drift for the same reason: the effective
policy has moved, and the old job is not topped up in place.

| Outcome | Code | Means |
| --- | --- | --- |
| permit | `INV-01/EDGE_IN_TABLE` | the transition is a row of the table |
| permit | `INV-01/FAILURE_STAGE_PERMITTED` | the transition is into `needs_human` or `blocked` |
| permit | `INV-01/TRIGGER_SATISFIED` | the row's trigger holds |
| permit | `INV-01/PRECONDITION_HOLDS` | a §14.2 precondition holds |
| reject | `INV-01/EDGE_UNKNOWN` | the transition is not a row of the table |
| reject | `INV-01/TRIGGER_FALSE` | the row's trigger does not hold |
| reject | `INV-01/TRIGGER_INPUT_MISSING` | an artifact the trigger presupposes does not exist |
| reject | `INV-01/PROTECTED_PATH_CHANGED` | the change touches a path the effective `protected_paths` reserves for a human, including the policy files themselves |
| reject | `INV-01/BLOCKED_CAUSE_MISSING` | the record is at `blocked` with no cause |
| reject | `INV-01/NEEDS_HUMAN_CAUSE_MISSING` | the record is at `needs_human` with no cause |
| reject | `INV-01/PRECONDITION_FAILS` | a §14.2 precondition fails |
| inconclusive | `INV-01/EDGE_CONVERSATIONAL` | the row is conversational; nothing exists on disk to check |
| inconclusive | `INV-01/EDGE_NOT_IMPLEMENTED` | the table has a row this validator has no predicate for |
| inconclusive | `INV-01/TRIGGER_INPUT_UNREADABLE` | an artifact exists but cannot be read |
| inconclusive | `INV-01/RECORD_UNREADABLE` | the record cannot be read, so the transition cannot be judged |
| inconclusive | `INV-01/NOT_EVALUATED` | no `--to` was given, so no transition was checked; the run cannot answer the question it was not asked |
| inconclusive | `INV-01/PRECONDITION_NOT_IMPLEMENTED` | a §14.2 precondition is not implemented |
| inconclusive | `INV-01/PRECONDITION_UNEVALUABLE` | a §14.2 precondition cannot be evaluated from what is on disk |
| inconclusive | `INV-01/HANDOFF_UNVERIFIABLE` | the handoff's own facts are not recorded in the job folder |

### INV-02 — required artifacts exist and validate

**Inspected:** the job folder, `schemas/job.schema.json` and
`schemas/evidence.schema.json`.

- The record validates against `schemas/job.schema.json`.
- The evidence package, when the stage requires one, validates against
  `schemas/evidence.schema.json`.
- The artifact required by the job's **current stage** exists.

The stage → artifact mapping is not invented here. It is the transition
table's own triggers (`spec.md`, `build.md`, the four verdict files,
`decision.md`, `evidence.json`) together with what the live harness asserts
about a capture: `build.md` from the stage the builder runs in onwards, and
`evidence.json` from the stage verification runs in onwards. It agrees with
`reference/status.md`, which reports "whether the artifact for the current
stage exists".

The validator asks at the moment a transition is proposed, so the stage's
artifact must already be there. The live harness asks about a job that has
stopped, which is why its `build.md` rule covers every stage the builder ever
reached.

| Stage | Required artifacts |
| --- | --- |
| `queued` | none |
| `planning`, `awaiting_plan_approval` | `spec.md` |
| `building` | `build.md` |
| `verifying`, `repairing` | `build.md`, `evidence.json` |
| `reviewing` | `build.md`, `evidence.json`, `round-<N>/review-{code,security,scope,visual}.md` |
| `awaiting_human_review` | `build.md`, `evidence.json`, the four verdict files, `decision.md` |
| `approved_to_merge`, `handed_off`, `merged` | `build.md`, `evidence.json`, the four verdict files, `decision.md` |
| `needs_human`, `blocked` | none — a parked job is not advancing while it waits |
| `rejected`, `cancelled` | none — a terminal job is not advancing |

A **missing artifact** is a reject. An artifact that exists but **cannot be
parsed** is an inconclusive when the file is unreadable or corrupt, and a
reject when it is readable but invalid against its schema. A **required
input** that is absent — the record — is an inconclusive: there is nothing to
validate.

| Outcome | Code | Means |
| --- | --- | --- |
| permit | `INV-02/RECORD_VALID` | the record validates |
| permit | `INV-02/EVIDENCE_VALID` | the evidence package validates |
| permit | `INV-02/ARTIFACT_PRESENT` | a required artifact exists |
| reject | `INV-02/RECORD_INVALID` | the record does not validate |
| reject | `INV-02/EVIDENCE_INVALID` | the evidence package does not validate |
| reject | `INV-02/ARTIFACT_MISSING` | a required artifact is missing |
| inconclusive | `INV-02/RECORD_MISSING` | the record is missing |
| inconclusive | `INV-02/RECORD_UNREADABLE` | the record cannot be read |
| inconclusive | `INV-02/EVIDENCE_UNREADABLE` | the evidence package cannot be read or parsed |
| inconclusive | `INV-02/ARTIFACT_UNREADABLE` | a required artifact cannot be read |

### INV-03 — claimed review verdicts have independent supporting evidence

**Inspected:** the record's `reviews` object, the four verdict files of the
record's round, and the record's `runtime.invocations`.

The record's `reviews` object *claims* a verdict per reviewer. The four
verdict files are the *evidence*. Nothing else compares them.
`tools/transition.mjs --sync` is the write that makes the claim match the
files; it never moves the stage, and a malformed file refuses the whole write
(`reference/review.md`).

1. A claimed verdict (anything but `pending`) requires the file at
   `round-<the record's round>/review-<role>.md`. A claim without a file is a
   reject: silence is a hard stop and a verdict is never defaulted.
2. The file's first line must be a legal verdict and must agree with the
   claim. A record claiming `PASS` beside a file saying `VERDICT: CHANGES` is
   a reject: the record and the artifact disagree. A `NOT_APPLICABLE` with no
   stated reason is malformed — `review.md` says it "stops the orchestrator
   just like a missing file" — and is a reject too.
3. A claimed `PASS` whose file carries a `blocking` finding is a reject: only
   blocking findings produce `CHANGES`.
4. A claimed `CHANGES` without a blocking finding cited as `file:line` is a
   reject.
5. **Independence.** The record's `runtime.invocations` must name a session
   for each reviewer that produced a verdict — an invocation whose `agent` is
   `reviewer-<role>` — and the reviewer sessions must be distinct. A verdict
   with no recorded invocation, or one whose `session_id` is shared with
   another reviewer, is a reject: four separate sessions are the point of a
   review round.
6. The **approver** is a different session from all four reviewers. A reviewer
   may not resolve its own findings. If `decision.md` exists and the record
   names no `approver` invocation, or the approver's session is a reviewer's
   session, that is a reject.

| Outcome | Code | Means |
| --- | --- | --- |
| permit | `INV-03/VERDICT_AGREES` | the claim and the file agree |
| permit | `INV-03/SESSION_RECORDED` | the reviewer that produced a verdict has a recorded session |
| permit | `INV-03/SESSIONS_DISTINCT` | the reviewers that produced verdicts ran in distinct sessions |
| permit | `INV-03/APPROVER_SEPARATE` | the approver ran in its own session |
| reject | `INV-03/VERDICT_FILE_MISSING` | a claimed verdict has no file |
| reject | `INV-03/VERDICT_MALFORMED` | the file's first line is not a legal verdict |
| reject | `INV-03/VERDICT_MISMATCH` | the claim and the file disagree |
| reject | `INV-03/VERDICT_UNRECORDED` | the claim is `pending` and the file says otherwise |
| reject | `INV-03/PASS_WITH_BLOCKING` | a claimed `PASS` carries a blocking finding |
| reject | `INV-03/CHANGES_WITHOUT_BLOCKING` | a claimed `CHANGES` cites no blocking finding as `file:line` |
| reject | `INV-03/NOT_APPLICABLE_WITHOUT_REASON` | a claimed `NOT_APPLICABLE` states no reason |
| reject | `INV-03/NO_INVOCATION` | a claimed verdict has no recorded invocation |
| reject | `INV-03/SHARED_SESSION` | two reviewers share one session |
| reject | `INV-03/APPROVER_IS_REVIEWER` | the approver's session is a reviewer's session |
| reject | `INV-03/DECISION_UNATTRIBUTED` | `decision.md` exists with no recorded approver |
| permit | `INV-03/NO_CLAIMS` | no verdict is claimed, so there is nothing to check |
| inconclusive | `INV-03/VERDICT_FILE_UNREADABLE` | a verdict file cannot be read |
| inconclusive | `INV-03/NO_REVIEWS` | the record carries no `reviews` object |

### INV-04 — verification evidence corresponds to the current change

**Inspected:** `evidence.json` and the job worktree's actual git state.

- Every check's `diff_ref` and the package's top-level `diff_ref` must refer
  to the same change. If they disagree with each other, that is a reject.
- The change they name must be the **current** change on the job branch —
  the branch's **tip**, which is what a push carries and what an approval is
  bound to. The job's worktree path is in `job.json.worktree`; it is resolved
  against the repository root and git is asked for
  `refs/heads/<job branch>`. The worktree's `HEAD` is a **different** commit
  whenever the worktree is not on the branch, and comparing against that would
  let evidence about one change pass for another.
- `diff_ref` occurs in **two different shapes** in this pack and the pack
  never reconciles them:
  - in `job.json` it is the job branch's **tip**;
  - in `evidence.json` the design spec's example is a **range**,
    `"39e1684..factory/001-about-faq"`.

  Both are handled. A range `A..B` names the change by its right-hand side,
  `B`; a single sha names it by itself. Every ref is then resolved through
  git, so the short sha the pack's own example uses (`"39e1684..…"`) is the
  same commit as the full sha git hands back, and a `B` that is a branch name
  resolves to the commit it points at. A ref whose shape is **neither** a
  range nor a sha is an **inconclusive** — the pack has no canonical shape
  for it — and is never a permit. A ref git cannot resolve names no commit
  this worktree knows, which is an inconclusive too, not a stale verdict.
- A ref that names a **different** commit than the job branch's tip is a
  reject: that is exactly the stale-evidence case.
- A check with `result: "passed"` and no exit status is a reject. This is an
  interpretation of `reference/fast-gate.md` — "an exit code of 0 does not
  mean a check ran" and "results come from actual execution" — rather than a
  sentence quoted from it: a pass with no exit status is an unsupported pass.

| Outcome | Code | Means |
| --- | --- | --- |
| permit | `INV-04/REF_AGREEMENT` | every `diff_ref` names the same change |
| permit | `INV-04/REF_CURRENT` | that change is the worktree's current HEAD |
| reject | `INV-04/REF_DISAGREEMENT` | a check's `diff_ref` disagrees with the package's |
| reject | `INV-04/REF_STALE` | the evidence names a different commit than the current HEAD |
| reject | `INV-04/PASS_WITHOUT_EXIT_STATUS` | a `passed` check has no exit status |
| reject | `INV-04/EVIDENCE_MISSING` | there is no evidence package |
| inconclusive | `INV-04/REF_SHAPE_UNKNOWN` | the ref is neither a range nor a sha |
| inconclusive | `INV-04/REF_UNRESOLVABLE` | the ref cannot be resolved to a commit |
| inconclusive | `INV-04/WORKTREE_UNREADABLE` | the job branch's tip cannot be read |
| inconclusive | `INV-04/EVIDENCE_UNREADABLE` | the evidence package cannot be read |

## The conversational transitions

Three rows of the table describe **states of the conversation, not writes to a
record**:

- `intake` → `needs_clarification`
- `intake` → `queued`
- `needs_clarification` → `queued`

The document says so itself: the intake gate runs before any `job.json`
exists, so a held request sits at `needs_clarification` in the conversation
only — no file ever says `stage: needs_clarification`. There is nothing on
disk to inspect for them, so **the validator does not implement them**. A
request against one of them returns `inconclusive`
(`INV-01/EDGE_CONVERSATIONAL`), never a permit and never a reject.

## The §14.2 preconditions

`reference/approval.md` defines six §14.2 preconditions, re-checked
immediately before a handoff. They live in one registry, and every one of them
is reported.

| # | Precondition | Status |
| --- | --- | --- |
| 1 | Approval is explicit, current, and bound to the current `diff_ref` | implemented |
| 2 | The required verification and review gates are complete | implemented |
| 3 | The base branch is known and has not moved unexpectedly | implemented |
| 4 | The working tree meets the merge mechanism's safety requirements | implemented |
| 5 | There is no unresolved conflict | implemented |
| 6 | The current diff matches the reviewed and approved change | implemented |

**A precondition nobody checks must not read as a precondition that holds.**
The registry keeps the `not_implemented` status for a precondition that cannot
be judged yet, and such a precondition is reported as
`INV-01/PRECONDITION_NOT_IMPLEMENTED` — an `inconclusive`, never a `permit`.
No precondition is registered that way today: all six are implemented.

How the six are read:

- **1** — the record carries an approval that names **this job** and an
  **approver**, and the binding it records is the change in the repository
  now: the approved `diff_ref` is a commit **sha** (a binding must name
  immutable content — a branch name keeps pointing at whatever comes next,
  and would never go stale) and it resolves to the job branch's **tip**, the
  approval's `base_commit` is the record's `base_commit`, the tracked working
  tree is clean and is the branch's own commit, and the base commit is still
  in the base branch's history.
  That is the **change identity** — `reference/approval.md` names it, and
  `tools/lib/change-identity.mjs` computes it.
- **2** — no check in the evidence package is `not_run` or `blocked`, and all
  four reviews have returned.
- **3** — the record names a base branch and a base commit, and the base
  branch is still where the record says it was. A base that moved forward has
  moved; `approval.md` and `state-machine.md`'s sixth invariant both say a
  moved base invalidates a pending handoff. (`git merge-base --is-ancestor`
  then says which kind of move it was: forward, or a rewrite that no longer
  contains the recorded commit.) A base that is **not recorded** is a missing
  input rather than a moved base: the check cannot be performed at all, so it
  is `inconclusive`.
- **4** — the tracked working tree is clean (`git status --porcelain
  --untracked-files=no`) **and the worktree is on the job branch**: its `HEAD`
  is the branch's tip. A clean worktree somewhere else is not the tree that
  was reviewed. Untracked files are not part of the pushed diff and do not
  affect the merge mechanism's safety.
- **5** — no path is left unmerged (`git diff --name-only --diff-filter=U`).
- **6** — the evidence package names the change the approval names: every
  `diff_ref` in it resolves to the job branch's tip. This is INV-04's
  question asked from the other side, and it reads the same refs.

### What the approval transitions answer now

- `awaiting_human_review` → `approved_to_merge` answers **`permit`** when the
  approval is bound to the current change and the other five preconditions
  hold, and **`reject`** when one of them does not. It is `inconclusive` only
  when an input it needs is missing — no worktree, no base commit, a ref that
  cannot be resolved.
- `awaiting_human_review` → `reviewing` (the stale-approval route) answers
  **`permit`** when the approved `diff_ref` no longer matches the current
  change — the identity check IS that trigger — and `reject` when it still
  matches.
- `approved_to_merge` → `handed_off` answers **`permit`** when the six
  preconditions hold, the full gate is recorded as `passed`, and the record
  carries the handoff the guarded tool wrote; `reject` otherwise. A full gate
  that is not recorded at all is `inconclusive` — the row's own
  `INV-01/HANDOFF_UNVERIFIABLE`.
- `approved_to_merge` → `awaiting_human_review` (a precondition fails, so the
  approval is cleared) answers **`permit`** when a precondition fails, and
  `inconclusive` when one of them cannot be judged.

The identity preconditions and the stale-approval route share one computation:
`tools/lib/change-identity.mjs`.

## Node

**Node 22.18.0 or newer.** 22.18.0 is the version that introduced
`import.meta.main`; this tool deliberately does not use it — it detects "run
as a program" by comparing `process.argv[1]` with `import.meta.url`, so a
CLI whose entry point silently does nothing cannot happen. The floor is
stated at 22.18.0 so the pack and the tool share one version requirement.

## What this changes about the pack

The pack used to be described as **"Markdown and JSON only"**. That is no
longer true, and the change is stated here plainly rather than left for
someone to discover.

`pack/tools/` now ships four small, dependency-free Node tools: **this**
validator — read-only, and the strict-subset JSON Schema validator it uses
(promoted out of the repository's test tree, so there is exactly one schema
validator in the project) — `tools/transition.mjs`, the guarded transition
writer that is the only writer of the job record, `tools/handoff.mjs`, the
guarded protected action that pushes the job branch and opens the pull
request, and `tools/queue.mjs`, the read-only queue report that answers what
dispatch may claim and why. The tools are installed to
`<target>/.opencode/skills/factory/tools/`, beside `reference/` and `schemas/`,
and `install.sh` copies them.

What has NOT changed: the pack still ships no runtime code beyond those four
tools, they have no dependencies (no `package.json`, no `node_modules`,
nothing to install), and the validator and the queue report are read-only. The
pack's documents are still the contract — the tools read
`reference/state-machine.md` for the transitions and `schemas/*.json` for the
schemas, and they hold no copy of
either.

## The reason codes are the contract

Every check the tool reports carries a reason code, and the codes are listed
above. Each code has exactly one outcome, and the reject codes and the
inconclusive codes are disjoint: a reason can never mean both "the inputs
violate the invariant" and "the validator could not decide". The codes live
in `tools/lib/reasons.mjs`, and `reference/validator.md` is their
documentation.
