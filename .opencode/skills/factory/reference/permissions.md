# Permissions — the OpenCode grant syntax (§6.3)

OpenCode evaluates a rule set for every agent/tool invocation. The factory **denies
first**, then permits only what a command needs; last matching rule wins, so broad
rules go before exceptions.

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
- If no rule matches, OpenCode defaults to `ask` (never allow).

## Factory contract (verified)

1. Every reviewer agent declares, in this order, **deny** first:

   ```yaml
   - action: edit
     resource: "*"
     effect: deny
   - action: shell
     resource: "*"
     effect: deny
   ```

   (Last-match-wins cannot widen the deny because nothing else is granted below it.)
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

## Related

- `tests/negative-approval.test.mjs` — reviewers' permission deny-anything pin.
- `pack/.opencode/agents/reviewer-{code,security,scope,visual}.md` — the actual rules.
- OpenCode docs: `agents.mdx`, `permissions.mdx`, and `config.mdx`.