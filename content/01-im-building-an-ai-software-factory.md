# I'm rebuilding an AI software factory in 30 days — a speed run, in public

*Day 1 of 30 · 27 Oct 2026 · Ray Shih*

## What I'm trying

From 24 October to 22 November I'm running a 30-day speed run called the Software Factory. I've already built a version of this over the past few months. This experiment rebuilds it from scratch by gluing off-the-shelf tools, to see how far that gets.

The idea is simple to say and harder to do well: take an issue from a GitHub backlog, have an AI agent work on it in a controlled environment, and end up with a pull request that has passed CI and is waiting for a human to approve, reject or request changes.

I'm a solo founder, I have a budget of US$300, and I'm going to publish what happens — including the parts that don't work. Weekly updates cover progress, cost, and where it broke. On 22 November I'll publish a final report with one of three decisions: Go, Pivot or Stop.

You make the wish and sign off on the result. AI does the rest. A human approves every merge. No auto-merge.

## Four pillars

1. **Coding** (in progress). You describe the problem, AI writes the code. This is what the 30 days is rebuilding. It does not work yet.
2. **PR Nursing** (planned). AI looks after the PR until it's ready: review feedback and tests.
3. **AI Review** (planned). It takes some of the code review load off you — an eval system to align agent review with human standards.
4. **Self-improve** (planned). It should get to know you better the more you use it.

Pillars beyond Coding are not built.

## Why

Coding agents can already write useful code. That's no longer the interesting question. The interesting question is what happens around the agent when you try to use it on real work, repeatedly, inside a team.

If you've tried this, you've probably hit some of the same problems I have. Which issues should the agent pick up, and how many at once? What happens when a run hangs or times out? If you retry, do you get two pull requests for the same issue? Did the session actually finish the task, or did it just go quiet? Did the tests pass? Who reviewed it? And what did it cost — including the runs that failed?

My hypothesis is that the bottleneck for teams isn't code generation any more. It's controlled, verifiable, reviewable execution. Specifically, I'm testing three things:

1. **Feasibility:** one person can build a reliable issue-to-PR pipeline in about a week by integrating existing infrastructure.
2. **Quality:** on standardised, low-risk tasks, a meaningful share of agent PRs — I'm aiming for 60%, and I'm treating that as exploratory — will be review-ready.
3. **Demand:** engineering leads with growing maintenance backlogs care enough about control, verification and auditability to try it.

I don't know yet whether any of these are true. That's the point of the experiment.

## Architecture

The pipeline looks like this:

**GitHub Issue → GitHub App / webhook → control plane (Next.js or Flask + Postgres) → Trigger.dev (queue, concurrency, retry) → Anthropic Managed Agents (session and sandbox) → branch + PR → GitHub Actions CI → human review.**

The control plane is the part I'm actually building. It receives issues, stores each one as a task, decides when it runs, tracks its state, and records everything that happens: retries, failures, cost, and how much time a human had to spend on it. Everything else is existing infrastructure.

## Build vs buy

The most important decision so far is what *not* to build.

I'm not building my own agent harness. I'm not building a Kubernetes scheduler. I'm not doing multi-model routing. Those are hard problems, other people are solving them well, and building them would eat the whole 30 days without testing my actual hypothesis.

So: Trigger.dev handles queues, concurrency limits and retries. Anthropic Managed Agents handles the agent session and sandbox. GitHub Actions handles verification. GitHub itself handles review. My job is the glue and the guarantees — making sure these pieces behave like one system you can trust.

I'm also explicitly not doing SaaS onboarding, billing, SSO, role-based access, multi-tenancy, analytics dashboards, auto-merge or deploy automation. If the experiment says Go, some of those come later. Not now.

## What I'll measure

I've written down the metrics before building anything, so I can't quietly move the goalposts later:

- **Time to first end-to-end PR.** Target: within 7 days.
- **Standardised task tests.** At least 12 benchmark issues — bug fixes, small features, test additions, refactors, a dependency bump and docs — run against a small demo repo I own. Each has explicit acceptance criteria written in advance.
- **Review-ready rate.** A PR only counts as review-ready if CI passes, it meets the predefined acceptance criteria, *and* the reviewer (me, for now) judges it doesn't need major rework. Passing tests alone doesn't count.
- **Cost per accepted PR.** Total model, runtime and CI cost — *including failed tasks* — divided by the number of PRs a human actually accepted. Failed runs are a real cost, so they stay in the numerator.

Every task gets logged: retries, tokens, cost, CI result, review outcome, minutes of human intervention and a failure category. I'll publish the raw tracker.

## Rules I'm holding myself to

These are the engineering principles the system has to respect, and the honesty rules I'm applying to this series:

- Integrate existing infrastructure; don't rebuild it.
- Keep the agent runtime decoupled from the control plane.
- Every external operation is idempotent. **Retries never create duplicate PRs.**
- An idle agent session is not a completed task.
- Every PR is reviewed by a human. No auto-merge.
- Record cost, human interventions and failure causes — always.
- Never run on a repository that hasn't been explicitly authorised.
- No invented numbers. If something fails, I'll say so and say why.

## Week 1

This week has one goal: a single working pull request, end to end, from a GitHub issue. It doesn't need to be robust. It needs to exist. Week 2 is reliability and orchestration, week 3 is trust and human oversight, week 4 is benchmarks and talking to potential users.

## Who I'd like to hear from

If you're a startup CTO or engineering lead and your maintenance backlog keeps growing — the bug fixes, test gaps, dependency bumps and small changes nobody gets to — I'd like to talk. I'm looking for a few pilot partners willing to try this on real, low-risk issues and tell me honestly whether it's useful.

You can [apply for the pilot here](https://docs.google.com/forms/d/e/1FAIpQLSfZh7CwGon-JaBn3jCNt1xi-JmAb0YNw9LavTTHIvuqcaiMLQ/viewform), or just reply and tell me what's in your backlog. I'll post each week on progress, cost, and where it broke.

---

## LinkedIn version (~150 words)

For the next 30 days (24 Oct – 22 Nov) I'm doing a speed run in public: rebuilding a Software Factory from scratch by gluing off-the-shelf tools. I've already built a version over the past few months. This is how far that rebuild gets.

You make the wish and sign off on the result. AI does the rest. A human approves every merge. No auto-merge.

Four pillars: Coding — you describe the problem, AI writes the code (in progress, not working yet). Planned, not built: PR Nursing, AI Review, Self-improve.

Stack: GitHub App → control plane (Postgres) → Trigger.dev → Anthropic Managed Agents → PR → GitHub Actions → human review.

Rules: retries never create duplicate PRs, every PR is human-reviewed, failed runs count towards cost. Weekly updates on progress, cost, and where it broke. Budget: $300. On 22 Nov: Go, Pivot or Stop.

CTOs and eng leads with a maintenance backlog — I'm looking for pilot partners: [link]

---

## X thread

**1/** Starting a 30-day speed run, in public (24 Oct – 22 Nov). I've already built a version of this. This time I'm rebuilding the Software Factory from scratch, gluing off-the-shelf tools, to see how far it gets. GitHub issue in, review-ready pull request out. Solo, $300. Weekly updates, including where it breaks. 🧵

**2/** You make the wish and sign off on the result. AI does the rest. A human approves every merge. No auto-merge. Pillars: Coding (in progress — you describe the problem, AI writes the code). Planned, not built: PR Nursing, AI Review, Self-improve. Day 1: nothing works yet.

**3/** Stack: GitHub App → control plane (Postgres) → Trigger.dev (queue/retry) → Anthropic Managed Agents (sandbox) → branch + PR → GitHub Actions → human review. Not building my own agent or scheduler.

**4/** Rules: idempotent external ops. Retries never create duplicate PRs. An idle session ≠ a finished task. Every PR is human-reviewed. No auto-merge. Never run on unauthorised repos.

**5/** Metrics, fixed in advance: first E2E PR in ≤7 days, 12 benchmark tasks, review-ready rate (target 60%, exploratory), cost per accepted PR — failed runs included.

**6/** Week 1 goal: one working PR, end to end. 22 Nov: final report and a Go / Pivot / Stop call.

**7/** CTOs / eng leads with a growing maintenance backlog: I'm looking for a few pilot partners. [link]
