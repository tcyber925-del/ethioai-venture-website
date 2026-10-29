# Permissions — the OpenCode grant syntax (§6.3)

OpenCode evaluates a rule set for every agent/tool invocation. The factory **denies
first**, then permits only what a command needs; last matching rule wins, so broad
rules go before exceptions.

**This pack targets OpenCode V2, and the grammar below is V2-only.** The
`permissions:` array in agent frontmatter, the `subagent` and `shell` action
names, and the base policy are V2 constructs. On V1 the `permissions:` key is not
read at all: every agent falls back to V1 defaults, in which most permissions
**allow**, `edit` and `shell` included — so each fence in this pack would be
absent, silently and with nothing logged. Install into V2.

## Syntax (source: OpenCode docs `permissions.mdx`)

A rule is three fields:

| Field | Meaning |
|---|---|
| `action` | Tool or permission action (edit, shell, subagent, read, …) |
| `resource` | Path, command, agent ID, or other matched value |
| `effect` | `allow`, `ask`, or `deny` |

Resources accept OpenCode's own glob flavour:

- `*` matches everything (the only wildcard the factory relies on).
- Command-by-file path globs such as `git *` (shell) or
  `packages/web/src/content/docs/*.mdx` (edit) are syntactically valid, but the
  factory does not ship any: reviewers are blanket-denied with `*` so there is
  nothing for a glob flaw to widen.
- For `read`, `edit`, and `external_directory`, `~` and `$HOME` expand.
  **Shell resources do not expand** — they stay raw command text.
- If no rule matches, the matcher falls back to `ask`. In OpenCode V2 that
  fallback almost never runs: every agent starts from a **base policy**, an
  ordered list whose first rule is `{action: "*", resource: "*", effect: "allow"}`
  and which asks only on a read of `*.env` or `*.env.*` (it also allows
  `*.env.example` outright). Something always matches, so the
  effective default is **allow**. Two consequences this pack relies on: a
  permission no rule mentions is granted rather than withheld, which is why
  every fence below is written out; and `reference/spawn.md` can state that the
  default policy already allows `external_directory`.

## Factory contract (verified)

1. Every read-only agent declares, in this order, **deny first** — and the
   deny is a deny-**all**, because a fence that names only what it denies is
   not a fence:

   ```yaml
   - action: "*"
     resource: "*"
     effect: deny
   ```

   Then the reads it needs, re-granted after the deny: `read` on `*`,
   `glob` on `*`, `grep` on `*`, and `external_directory` on `*` (the job's
   worktree is outside the checkout). Then the base policy's three `.env`
   rules, re-granted in its own order — `*.env` asks, `*.env.*` asks,
   `*.env.example` allows — so the deny-all does not turn a QUESTION about a
   secret into a flat denial. Then, at last, its own write: the reviewer its
   verdict file, `spec-writer` its `spec.md`, `approver` its `decision.md`,
   — and nothing else. `reviewer-visual` included: it judges the UI from the
   diff and the source, because its fence denies every action but the reads
   and its own verdict, so it cannot launch a browser or capture a
   screenshot. The port a UI job is given is reserved, not consumed.

   Why a deny-all and not the three named denies this clause used to list:
   OpenCode's base policy allows every action no rule mentions, and the
   action is matched by the same glob matcher as the resource — so
   `action: "*"` denies every action, while a fence naming only `edit`,
   `shell` and `subagent` left `execute` (the remote sandbox) and every MCP
   tool the operator has configured open to a read-only reviewer. The model
   declined to use them; the fence's intent did not hold them back.

   (Last-match-wins cannot widen the deny because nothing is granted before
   the re-grants that follow it.)
2. Agents in `push` mode, and the orchestrator, retain their own action set per
   role, but never use `*` as a source of a *new* grant — only as a baseline.
3. A scoped grant beyond blanket `*` must be accompanied by an explicitly cited
   OpenCode docs reference and a test asserting it denies an in-scoped and
   out-of-scoped path.
4. **Glob verification** (was formerly "unverified"): confirm the OpenCode
   release used by the pack accepts `*` alone as the documented broadest match,
   and that the reviewer agent harness does not treat `*` as a regexp. Runtime
   glob behaviour is the engine's; the pack pins only the source-form written
   above so that a change to the engine visibly requires a pack edit here.
5. **The orchestrator may launch the seven pack agents; the six agents the
   read-only fence binds may not launch subagents at all.** Those six are the
   four reviewers, plus `approver` and `spec-writer`: each denies `edit` and
   `shell` on `*` — beyond, at most, one carve-out, for its own artifact or its
   own evidence — so each is one delegation away from an agent that can write
   and run whatever it likes. The factory used to run its agents by shelling
   out to Herdr, so it needed no grant beyond `shell`. Launching a named
   subagent is a separate action on a separate resource — the selected agent's
   id — in the grammar `permissions.mdx` documents above, so the launch surface
   is declared explicitly, once per agent id, all seven of them and not one
   worked example:

   ```yaml
   - action: subagent
     resource: "spec-writer"
     effect: allow
   - action: subagent
     resource: "builder"
     effect: allow
   - action: subagent
     resource: "reviewer-code"
     effect: allow
   - action: subagent
     resource: "reviewer-security"
     effect: allow
   - action: subagent
     resource: "reviewer-scope"
     effect: allow
   - action: subagent
     resource: "reviewer-visual"
     effect: allow
   - action: subagent
     resource: "approver"
     effect: allow
   ```

   An id outside those seven matches no rule in this list, which is what makes
   it a declaration rather than a sample: a pack that grows an eighth agent has
   to add an eighth rule here.

   **Where the grant lives.** Not in a file the pack installs — `install.sh`
   copies the agents, the skill, `reference/`, `schemas/` and `templates/`, and
   no `opencode.json` ships the seven allows. This block is the declared
   contract the orchestrator is checked against, not a config file to copy. An
   operator whose own OpenCode config narrows `subagent` for the agent running
   the factory writes the seven rules there.

   **Stated, not assumed.** What an engine permits by default is the engine's
   business, and this document pins only what it owns: the list above.
   `/factory dispatch` treats it as a **precondition**, checked in the same
   step as the Herdr checks and before any job is claimed
   (`reference/spawn.md`). A target repo whose config narrows `subagent` would
   otherwise stall the factory with nothing declared, and a declared
   precondition turns that stall into a named failure.

   The same six go the other way: **they may not launch subagents at all.**
   The deny-all of clause 1 covers `subagent` with every other action, and
   the capability is what matters — an agent that cannot launch a subagent
   cannot launch one holding `edit` and `shell`, so the read-only boundary
   the review round rests on is not one delegation away from gone. There is
   no second rule for it, and there does not need to be: the property is
   pinned by evaluating the fence, not by looking for a rule.
   `tests/permission-fences.test.mjs` resolves `subagent` on any agent to a
   denial for all six.

## What this does NOT fence, and is not fenced here

`builder` holds `edit` and `shell` on `*` — it is the one agent that changes
source — so it keeps the base policy's `execute` and the operator's MCP tools
as well. That is **not** fenced by this pack, and the gap is deliberate
rather than overlooked: a builder has to run the project's own commands, and
the shape of what it may run is the project's, not the pack's. The cost is
real, and it is the same cost the read-only agents used to carry: the base
policy grants it, and only the model declines to use it. Fencing it means
naming a sandbox the pack does not own, or enumerating MCP tools the pack
cannot know — the problem G1's deny-all solves for the six, and not solved
for the seventh.

## Related

- `tests/negative-approval.test.mjs` — reviewers' permission deny-anything pin.
- `tests/spawn.test.mjs` — clause 5's `subagent` pins: the seven grants by
  rule, the out-of-scope direction clause 3 requires, and the reviewer denial.
- `pack/.opencode/agents/reviewer-{code,security,scope,visual}.md` — the actual rules.
- OpenCode docs: `agents.mdx`, `permissions.mdx`, and `config.mdx`.