# Intake configuration

## Eligibility label

`agent-ready` — set explicitly by a human. Its presence authorizes the factory
to *consider* the issue. It does not authorize an agent to write code.

| Provider | Filter |
| --- | --- |
| Linear | team `ENG`, status in {Todo, In Progress}, label `agent-ready` |
| GitHub | issue open, label `agent-ready` |

## Manual intake

A human may also hand a request directly to `/factory <description>`. Tracker
polling — provider filters, the pipeline, and the reporting contract — is
specified in `.opencode/skills/factory/reference/intake.md`.
