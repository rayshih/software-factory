# Software Factory — 30-Day Speed Run (24 Oct – 22 Nov 2026)

A version of this already exists from the past few months. This experiment rebuilds it from scratch by gluing off-the-shelf tools, to see how far it gets in 30 days. Weekly updates on progress, cost, and where it broke.

You make the wish and sign off on the result. AI does the rest. A human approves every merge. No auto-merge.

## Four pillars
1. **Coding** (in progress). You describe the problem, AI writes the code. This is what the 30 days is rebuilding. It does not work yet.
2. **PR Nursing** (planned). AI looks after the PR until it's ready: review feedback and tests.
3. **AI Review** (planned). Takes some of the code review load off you — an eval system to align agent review with human standards.
4. **Self-improve** (planned). It should get to know you better the more you use it.

Pillars beyond Coding are not built.

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
| W1 | 24–30 Oct | First working end-to-end PR |
| W2 | 31 Oct – 6 Nov | Reliability & orchestration (concurrency, retries, failure handling) |
| W3 | 7–13 Nov | Trust & human oversight (review flow, audit log, cost tracking) |
| W4 | 14–20 Nov | Benchmark runs & market validation |
| Final | 22 Nov | Public report with Go / Pivot / Stop decision |

## KPIs
- **First E2E PR** in ≤7 days.
- **≥12 standardised task tests** run (see benchmarks/).
- **Review-ready rate ≥60%** (exploratory). Review-ready = CI passes + meets predefined acceptance criteria + reviewer judges no major rework needed.
- **Cost per accepted PR** = total model + runtime + CI cost (including failed tasks) ÷ human-accepted PRs.

## Decision gates
- **Day 7 (30 Oct):** no E2E PR → cut scope to the minimal path before adding reliability features.
- **Day 14 (6 Nov):** retries/concurrency not working without duplicate PRs → fix before any benchmark runs.
- **Day 21 (13 Nov):** exact thresholds for pilot interest are fixed and published, before benchmark runs.
- **Day 30 (22 Nov):**
  - **Go:** review-ready rate near/above target, credible cost per accepted PR, and real pilot interest from ICP.
  - **Pivot:** pipeline works but quality or demand is weak → change task type, ICP or positioning.
  - **Stop:** pipeline unreliable and no meaningful demand signal.

## Budget
US$300 total across model, runtime, CI and tooling. Spend tracked in metrics/tracker.csv; failed tasks count.
