# Fast gate

Verification is a hard gate, not a narrative the builder writes about itself.

## Two tiers

**Fast gate** — every build round. The profile's `fast_gate` command. For this
pilot: `npm run format:check && npm run lint && npm run typecheck && npm run test`.
No build step, so it runs on every rework without waiting on Astro.

**Full gate** — once, before handoff. The profile's `full_gate` command. For this
pilot: `npm run verify`. This must match the repository's CI exactly, or "verified"
means two different things locally and remotely.

## Never invoke an individual check script

`check:dist`, `check:seo`, `check:work`, `check:fonts` and `check:pending` all read
`dist/`. Run one without a preceding `astro sync && build` and it passes against
**yesterday's build**. That is a green light on a broken change — the failure mode
that erodes trust in every other gate.

The full gate is one command, in order, from a fresh build. Never a subset.

## not_run and blocked are not passes

`result` is one of `passed`, `failed`, `blocked`, `not_run`, `not_applicable`.
Only `passed` and `not_applicable` advance a job.

**An exit code of 0 does not mean a check ran.** `node --test` exits 0
when it matched no files. A missing script exits non-zero only because the shell
noticed — if the profile names a command that does not exist, that is `blocked`
with a reason, never `passed`.

Missing test infrastructure is a limitation to disclose, not permission to invent
a successful result.

## Recording

Every check writes a record to `evidence.json` with the check's name, its
`category`, the command, working directory, `diff_ref`, start and end times,
exit status, an output reference, the result, and — for `blocked`, `not_run`,
or `not_applicable` — a required reason.

If a repair changes the diff, every check affected by that change re-runs. The
final package must correspond to the diff submitted for approval.

Results come from actual execution. An agent asserting that it ran something is
not evidence.

## The full gate is recorded in the job record

The full gate runs **once, before the handoff**, and its result is recorded in
the job record's `full_gate` — the command, the exit status and the result.
It is not in `evidence.json`: that package is the verification stage's record
of the checks it ran against the diff, and the full gate is a later, separate
run.

The record is where the handoff reads it. `reference/state-machine.md`'s row
into `handed_off` says "the full gate passes", and a full gate nobody
recorded is a full gate nobody can show passed.
