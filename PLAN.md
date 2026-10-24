# Software Factory — 30-Day Plan (26 Oct – 24 Nov 2026)

## Thesis
Agent code generation is commoditising; the bottleneck is controlled, verifiable, reviewable execution. A thin control plane over existing infra can turn backlog issues into review-ready PRs at a cost and reliability teams would pay for.

### Hypotheses
1. **Feasibility:** A solo founder can build a reliable issue→PR pipeline in ≤7 days by integrating existing infrastructure (GitHub, Trigger.dev, Anthropic Managed Agents).
2. **Quality:** For standardised, low-risk tasks, ≥60% of agent PRs are review-ready (exploratory target).
3. **Demand:** Startup CTOs / eng leads with maintenance backlogs value execution control, verification and auditability enough to pilot it.

## ICP
Startup CTOs and engineering leads (roughly 5–50 engineers) with growing maintenance backlogs: bug fixes, test gaps, dependency bumps, small features, docs.

## Value proposition
Turn your engineering backlog into verified, review-ready pull requests — with controlled execution, visibility, and human approval.

**Differentiators:** task queue & scheduling · execution control · failure recovery · CI verification · human oversight · auditability · cost visibility.

## MVP scope (must-haves)
GitHub App · issue webhook · task persistence · idempotent submission · Trigger.dev queue · global and per-repo concurrency · agent session execution · timeout/retry/failure handling · branch + PR creation · CI verification · human review · audit log · cost tracking.

## Non-goals
SaaS onboarding · billing · RBAC/SSO · multi-tenant · own agent harness · own k8s scheduler · multi-model routing · complex analytics · auto-merge · deploy automation.

## Principles
1. Integrate existing infrastructure; don't rebuild it.
2. Decouple the agent runtime from the control plane.
3. Idempotency on every external operation.
4. Retries never create duplicate PRs.
5. An idle agent session is not a completed task.
6. Every PR is human-reviewed.
7. Record cost, human interventions and failure causes.
8. Never run on unauthorised repositories.

## Roadmap
| Week | Dates | Goal |
|---|---|---|
| W1 | 26 Oct – 1 Nov | First working end-to-end PR |
| W2 | 2 – 8 Nov | Reliability & orchestration (concurrency, retries, failure handling) |
| W3 | 9 – 15 Nov | Trust & human oversight (review flow, audit log, cost tracking) |
| W4 | 16 – 22 Nov | Benchmark runs & market validation |
| Final | 24 Nov | Public report with Go / Pivot / Stop decision |

## KPIs
- **First E2E PR** in ≤7 days.
- **≥12 standardised task tests** run (see benchmarks/).
- **Review-ready rate ≥60%** (exploratory). Review-ready = CI passes + meets predefined acceptance criteria + reviewer judges no major rework needed.
- **Cost per accepted PR** = total model + runtime + CI cost (including failed tasks) ÷ human-accepted PRs.

## Decision gates
- **End W1:** no E2E PR → cut scope to the minimal path before adding reliability features.
- **End W2:** retries/concurrency not working without duplicate PRs → fix before any benchmark runs.
- **End W4 / 24 Nov:**
  - **Go:** review-ready rate near/above target, credible cost per accepted PR, and real pilot interest from ICP.
  - **Pivot:** pipeline works but quality or demand is weak → change task type, ICP or positioning.
  - **Stop:** pipeline unreliable and no meaningful demand signal.
  (Exact thresholds for interest to be fixed before W4 starts, and published.)

## Budget
US$300 total across model, runtime, CI and tooling. Spend tracked in metrics/tracker.csv; failed tasks count.
