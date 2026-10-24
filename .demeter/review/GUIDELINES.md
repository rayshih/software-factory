# Repository review guidelines

Read `AGENTS.md`, `README.md`, `PLAN.md`, and `SETUP.md` alongside the requested
change. Review only the proposed scope. The roadmap records product intent;
it does not authorize implementation of future milestones.

## Human control

Every PR starts as a draft. A human authorizes readiness, reviews the current
changes, and performs every merge after required checks pass. New changes
require renewed human review. Automatic merging is prohibited, including
merge-when-ready, automated merge queues, and merge API calls by agents.

Repository review and nursing are enabled in `review_only` mode for all open
PRs regardless of labels, with a limit of 10 open PRs per scan. Merging this
configuration opts open PRs into review and nursing when the runner refreshes,
subject to the external authority and policy checks. It
grants no live-merge or project-management authority. PR-loop coverage remains
required and draft readiness remains disabled.

Per-PR configuration and review policy are read from the PR's recorded base
commit, not its proposed head. That base must contain the enabled configuration
and required policy files. Refresh the recorded base after changes to its
target branch; stacked PRs whose base branches lack these files or retain
disabled settings need their bases updated before processing. Configuration
changes in a PR cannot authorize that same PR. Changes to scan scope,
permissions, or external integrations require human review.

## Classification

- `allowed_changes`: work with no repository-policy objection, such as a
  behavior-preserving cleanup. This is not approval or merge authority.
- `needs_review_changes`: intentional changes requiring human judgment, such
  as behavior, schema, dependency, product-scope, or policy changes. They may
  be accepted unchanged after review.
- `not_allowed_changes`: violations that should be corrected, including
  automatic merging, unauthorized repository access, leaked credentials,
  fabricated results, or bypassing validation and authorization controls.

Use the most restrictive applicable category. Report uncertain or unowned
changes for human review rather than inventing approval. Policy edits cannot
authorize themselves: evaluate a PR using the policy from its base commit.
Inherited system checks, test recognition, and sensitive-path restrictions
remain in force. Sensitive paths can block automated readiness even when a
change is legitimate for a human to review.

## Repository-specific review

- Control plane: preserve idempotent task submission, retries without duplicate
  PRs, valid state transitions, bounded execution, audit records, and cost
  accounting. Verify migrations against existing data and review webhook
  signature validation, credentials, and repository allowlists explicitly.
- Tooling: preserve the pnpm lockfile, CI checks, Graphite stack relationships,
  draft status, and human merge control. Do not infer this repository's branch
  protections from the demo repository described in `SETUP.md`.
- Documentation: distinguish planned capabilities from implemented behavior.
  Keep English and Traditional Chinese product claims consistent. Review
  landing-page changes visually; changes under `docs/` are published by the
  existing Pages workflow after a push to `main`.
- Plans and records: preserve source evidence for benchmarks, costs, failures,
  and human interventions. Changes to goals, budget, success criteria, or
  pilot commitments require human judgment. Do not invent execution slices,
  test outcomes, customer commitments, or completed milestones.

## Validation evidence

Use the commands and scope guidance in `AGENTS.md`. Report what ran, what
passed or failed, and what was skipped. Control-plane CI is path-filtered;
an absent run is not a pass. The current CI job is `check`, not the demo
repository's documented `test` requirement. Build is an additional local
check. Repository configuration and policy changes require validation with
the consuming parsers, including trait resolution and representative path
matching; JSON/TOML syntax checks alone are insufficient.

`PLAN.md` remains the existing roadmap, not an executable task queue. This
configuration does not register a project or authorize product execution.
