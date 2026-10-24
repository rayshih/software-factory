# Software Factory

> Turn your engineering backlog into verified, review-ready pull requests — with controlled execution, visibility, and human approval.

A 30-day Build in Public experiment (26 Oct – 24 Nov 2026) by Ray Shih, solo founder.

## Thesis
Coding agents can already write code. What teams lack is the *factory* around them: a queue, execution control, failure recovery, CI verification, human review, an audit trail and cost visibility. Software Factory is that control layer — built by integrating existing infrastructure, not by building another agent.

## Architecture
```mermaid
flowchart LR
  A[GitHub Issue] --> B[GitHub App / Webhook]
  B --> C[Control Plane<br/>Next.js or Flask + Postgres]
  C --> D[Trigger.dev<br/>queue · concurrency · retry]
  D --> E[Anthropic Managed Agents<br/>session / sandbox]
  E --> F[Branch + Pull Request]
  F --> G[GitHub Actions CI]
  G --> H{Human review}
  H -->|approve| I[Accepted PR]
  H -->|request changes| D
  H -->|reject| J[Closed + failure recorded]
  C -.audit log · cost tracking.-> K[(Postgres)]
```

## What it does (MVP)
- Receives labelled GitHub issues via a GitHub App, persists tasks idempotently
- Queues work with global and per-repo concurrency limits
- Runs each task in an agent session with timeouts, retries and failure handling
- Opens a branch + PR (retries never create duplicate PRs), waits for CI
- Requires human review on every PR; records cost, interventions and failure causes

## Not doing
SaaS onboarding, billing, RBAC/SSO, multi-tenancy, a custom agent harness, a custom scheduler, multi-model routing, auto-merge, deploy automation.

## Status
Day 1 — planning. No working pipeline yet. Results will be published here as they happen, including failures. See [PLAN.md](PLAN.md) and [benchmarks](benchmarks/BENCHMARK_ISSUES.md).

## Join the pilot
Startup CTO or engineering lead with a growing maintenance backlog? I'm looking for a few design partners to try this on real (low-risk) issues.
👉 [Apply for the pilot](https://example.com/PILOT_LINK_PLACEHOLDER)
