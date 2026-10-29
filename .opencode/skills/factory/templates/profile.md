# Project profile

Copy to the target repository as `.factory/profile.md` and fill in every field.
A missing critical field is a **blocker**, never an invented default: the
installer names the field it is missing and copies nothing. The field list is
the pack's `schemas/profile.schema.json` — ten required fields, and
`concurrency` as the only optional one.

## repo
Owner/name of the git repository.

## base_branch
Branch every job branches from and hands off to.

## setup_command
Command that prepares a fresh checkout (install dependencies, generate types).

## fast_gate
Verification command run on every build round. Must not require a build step.

## full_gate
Verification command run once before handoff. Must match CI exactly.

## high_risk_areas
Paths or subsystems that force the `approval` tier and always escalate.

## protected_paths
<!-- One `- <glob>` bullet per path, or `none`. A change touching one stops for a human on every tier, before verification. `.factory/profile.md` and `.factory/policies/**` are always protected, even with `none`. -->
none

## review_perspectives
Which reviewers apply to this project, and any project-specific checklist.

## non_goals
Explicitly out-of-scope work that must not be introduced.

## known_limitations
Things this project's checks do not cover. Disclose; never paper over.

## concurrency
Jobs `/factory dispatch` runs in parallel when given no argument. Optional;
defaults to 3. Hard-capped at 5. One value applies to the whole project.
