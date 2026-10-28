# Lessons

Running notes from the 30-day Software Factory build-in-public experiment. These takeaways feed the articles and the Day 30 report.

## 2026-10-26 — Day 3

**Some coding and review agents over-engineer.**

Some agents labeled issues that were not serious as P1. Running the agent pull-request fix loop on those items wasted time and slowed the pull-request process. A loop that treats a minor note as a blocker spends effort on comments that should not hold up the change.

Next: calibrate severity against human review standards so only real blockers trigger fix loops. This belongs with the planned AI Review eval and the Self-improve pillar.
