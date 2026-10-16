# Specification gate

A lit factory moves human judgment upstream rather than tacking review onto
the end. This is that upstream gate.

## Rule

| Tier | Spec gate |
| --- | --- |
| `auto` | no |
| `review` | no |
| `approval` | **yes** |

At `planning`, if `risk_tier` is `approval`, set
`stage: awaiting_plan_approval` and stop.

**Never proceed on your own.** Only `/factory go <job-id>` sets
`spec_approved: true` and moves the job to `building`. The human reads
`spec.md` first — a decision reviewed before it is built costs minutes; the
same decision found in a finished diff costs hours of rework.

## Why `approval` only

Most work in a bounded website or service feature is small and reversible.
Gating every job would make the factory slower than doing the work directly.
Gating the tier where a wrong call is expensive — architecture, auth, public
claims, scope expansion — captures the leverage without the tax.

If a job that started `auto` grows into `high_risk_areas`, pause, reclassify to
`approval`, and return to this gate. Reclassification is not a failure; it is
the gate working.
