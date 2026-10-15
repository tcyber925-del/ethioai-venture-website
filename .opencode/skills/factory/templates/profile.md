# Project profile

Copy to the target repository as `.factory/profile.md` and fill in every field.
A missing critical field is a **blocker**, never an invented default.

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

## review_perspectives
Which reviewers apply to this project, and any project-specific checklist.

## non_goals
Explicitly out-of-scope work that must not be introduced.

## known_limitations
Things this project's checks do not cover. Disclose; never paper over.
