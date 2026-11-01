# Isolation and user-work protection

Every job works in its own git worktree. The user's main checkout is theirs.

## Order of operations

Inspect first, create second. Never the reverse.

```bash
git status --porcelain
git rev-parse <base_branch>
```

A dirty checkout **does not block** job creation. It is the user's work in
progress. Record `base_branch` from the profile and `base_commit` from the
output above — the commit the base branch names. Not `HEAD`: that is whatever
the user happens to have checked out, and a dispatch from a feature branch
would otherwise record, and branch from, the wrong commit.

## Forbidden, without exception

Never run `git reset`, `git checkout --`, `git stash pop`, or `git clean`.
Each discards the user's uncommitted work. If a step appears to require one,
stop, set `needs_human`, and explain what is blocking.

Never modify anything in the main checkout except `factory/jobs/`.
That directory is runtime state; everything else belongs to the user.

## The main checkout's guard

That rule is not only prose. The transition writer checks it before every
write it makes, and the guarded protected action checks it before it pushes:
the main checkout is listed with the hash of every file's content, and the
listing is compared with the one the job recorded when it started. Anything
outside `factory/jobs/` that moved is a refusal — the job does not advance,
and the refusal is recorded in the job's own rejection log.

The comparison is against the job's own baseline, so the user's uncommitted
work, which the checkout may well carry, appears in both listings and cancels
out. Only a change made after the job started is a violation.

**A base branch that advanced is not a violation.** The check has three
outcomes, not two. When the difference is entirely committed — every differing
path is clean against `HEAD` — the base branch moved because work landed on it,
which is how this factory's own pull requests merge, and the baseline is
refreshed rather than the job refused. Without that, the fix for a wedged job
would re-wedge it: the fix lands through a merge, and the merge is what the
guard would see. A difference the user has *not* committed is still a refusal,
and only the dirty paths are named, so a job cannot advance over work in
progress.

The same job-scoped comparison holds for the protected-path policy: the policy
is bound to the job when it is claimed, and the transition into `verifying` and
the guarded handoff check that binding again. The effective binding always
includes `.factory/profile.md` and `.factory/policies/**`, even when the
profile says `none`, so a job cannot edit the policy files it is judged by. A
policy that moved after the claim, a binding without the floor, or a job with
no binding (never claimed, or claimed before bindings existed), is inconclusive
rather than authoritative.

The lock the writer takes is an exclusive `mkdir` (no `-p`) of a directory
beside the record. Its failure is read by its cause: `EEXIST` means another
run holds it, `ENOENT` means the job folder is not there.

## Worktree creation

```bash
herdr worktree create --cwd <absolute path to the main checkout> --base <base_branch> --branch factory/<job-id> --path ../<repo>-factory/<job-id> --label <job-id> --no-focus
```

`--cwd` is load-bearing, not decoration. Herdr resolves the source repository
from the session it is invoked in, and **not** from the working directory: run
the command above from a session anchored to some other repository, without
`--cwd`, and the job's worktree *and* its `factory/<job-id>` branch are created
in that other repository, which nobody dispatched into and whose user never
asked for a branch. `--cwd` names the main checkout, so the command can only
mean the repository it was meant for.

`--base` is load-bearing for the same reason. Without it Herdr branches from
`HEAD` — whatever the main checkout has checked out — so a dispatch from a
feature branch or a detached `HEAD` silently bases every job on the wrong
commit, and the base the record names is one the job never started from.
`--base <base_branch>` names the branch the profile declares, so the base is a
fact of the profile rather than of the user's working session.

The worktree must be a Herdr *workspace*, not just a directory, so that the
job's work is registered under its label and an operator can attach to that
workspace directly. `/factory status` reports the `workspace_id` this returns,
recorded in `job.json` — never a Herdr query.

Claim the directory with a plain `mkdir` first so a concurrent dispatch cannot
take the same path. Read that `mkdir`'s failure by its cause: `EEXIST` means
another run got there first, so that job belongs to the run holding the path;
`ENOENT` means the shared parent `../<repo>-factory/` does not exist yet —
create the parent, then claim again. An `ENOENT` read as "another run holds this
job" abandons every job in the batch, on a diagnosis that is not true.

If creating the worktree fails after the claim succeeded, release the claim
with a plain `rmdir` on that path before setting `blocked` with the cause. A
plain `rmdir` refuses a non-empty directory, so it cannot delete a partial
worktree; but a claim left behind with no worktree strands the job, because no
subsequent dispatch will take a path it believes another run holds. If the
directory is not empty — Herdr got far enough to write into it — leave it and
park `needs_human` with the path, so the partial worktree is preserved for
inspection; that claim is cleared by hand when it is dealt with.

Then run the profile's `setup_command` inside it — a fresh checkout has no
`node_modules`, no generated types, no `.env`. **If setup fails, stop and set
`blocked` with the cause.** Never continue on a half-prepared tree.

A job that serves a UI is given a port: `5101 + 10n`, where `n` is the job
number. Job numbers are unique, so ports stay unique. (The pack's visual
reviewer does not use it — its fence denies every action but the reads and its
own verdict — so the port is reserved rather than consumed. `permissions.md`
says what the visual reviewer can and cannot do.)

## Precedence

Where this document and the target repository's `AGENTS.md` disagree,
`AGENTS.md` wins for its own repository, and you raise the disagreement to a
human as a Change Request rather than resolving it yourself. This matters
today: an instruction to delete feature branches as soon as their work is
"merged or otherwise completed" must not be read as covering a job parked at
`needs_human` — but the conflict is still raised, not silently overridden in
either direction.

## Cleanup

**Do not automatically delete failed-job artifacts.** A worktree and branch
persist until the result and required evidence are preserved. Terminal stages
split: `needs_human` preserves — that is where every Plan 1 job ends, and its
worktree and branch must survive for the human to inspect. Only `merged` and
`cancelled` remove the worktree, and removal is reported — a failed cleanup is
reported, never swallowed.

## What a worktree does not give you

A git worktree separates working directories and branches. It **does not provide
process, filesystem, credential, or network isolation.** Concurrent jobs share
the machine, the network, and any credential in the environment. v1 accepts this
for a local single-user pilot and states it plainly rather than implying safety
it does not have.

## The main checkout is checked, not just promised

The rule above — nothing in the main checkout changes except `factory/jobs/` —
is checked before a write, not only after a run. The live harness checks it
afterwards, against a hashed listing of the whole tree; the transition writer
checks it *before* it writes a record, so a mistake is caught before it does
damage.

The listing is a hash of every file's content, and the comparison is against
a **baseline taken when the job was written**. That matters: the user's own
uncommitted work is in both listings and cancels out, so only a change made
*after* the job started is a violation. A dirty checkout is still the user's
work in progress, and a tool that treated it as damage would be a tool that
told people to throw their work away.

The baseline is taken when the job's record is created through the transition
tool, which is the only way a record is created. A record written by hand has
its baseline taken at the first tool call, and a change made between the two
is not the tool's to judge — it is inside the baseline, and only what comes
after it is reported.

The check is the same shape the live harness uses, so the two agree about what
"changed" means.
