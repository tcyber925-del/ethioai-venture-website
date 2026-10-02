# Software Factory v1

## Repository boundary

- `tcyber925-del/ethioai-venture-website` (this repository) is the dedicated website codebase and the only place website source lives.
- `tcyber925-del/ethioaiventure` is the Hermes intelligence-agent profile repository. It must never be used as, or confused with, the website codebase.

This directory documents the repository-local operating model for the EthioAI Venture website.

The factory deliberately uses existing systems rather than introducing a custom orchestration platform:
- Notion: durable specifications and decisions
- Linear: execution queue and change control
- Hermes: orchestration
- GitHub: source, PRs, CI and release history
- Coding agents: bounded implementation workers

The factory optimizes for evidence, traceability and small changes—not autonomous complexity.
