# Isolation and user-work protection

Every job works in its own git worktree. The user's main checkout is theirs.

## Order of operations

Inspect first, create second. Never the reverse.

```bash
git status --porcelain
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
```

A dirty checkout **does not block** job creation. It is the user's work in
progress. Record `base_commit` and `base_branch` in `job.json` from the output
above.

## Forbidden, without exception

Never run `git reset`, `git checkout --`, `git stash pop`, or `git clean`.
Each discards the user's uncommitted work. If a step appears to require one,
stop, set `needs_human`, and explain what is blocking.

Never modify anything in the main checkout except `factory/jobs/`.
That directory is runtime state; everything else belongs to the user.

## Worktree creation

```bash
herdr worktree create --branch factory/<job-id> --path ../<repo>-factory/<job-id> --label <job-id> --no-focus
```

The worktree must be a Herdr *workspace*, not just a directory, so that
`/factory status` can report pane state against the job (§19).

Claim the directory with a plain `mkdir` first so a concurrent dispatch cannot
take the same path. Then run the profile's `setup_command` inside it — a fresh
checkout has no `node_modules`, no generated types, no `.env`. **If setup fails,
stop and set `blocked` with the cause.** Never continue on a half-prepared tree.

Ports derive from the job number `n`: stage agents `5100 + 10n`, and
`reviewer-visual` `5101 + 10n`. Job numbers are unique, so ports stay
unique.

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
