# Implementation Workflow

1. Linear issue reaches Ready.
2. Factory assembles issue + relevant specification + AGENTS.md + repository context.
3. Worker creates a branch containing the Linear issue identifier.
4. Worker implements only approved scope.
5. Worker runs deterministic checks.
6. Worker opens a PR linked to the Linear issue.
7. GitHub Actions provides authoritative CI results.
8. A fresh review context evaluates scope, acceptance criteria, architecture and quality.
9. Human approval is required for Review-class work.
10. Merge only after required checks/reviews.
11. Release and update Linear.
12. Capture observations as new Linear work.

If requirements conflict: stop immediately and create a change request.
