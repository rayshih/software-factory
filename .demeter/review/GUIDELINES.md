# Repository review guidelines

Read `AGENTS.md`, `README.md`, `PLAN.md`, and `SETUP.md` alongside the requested
change. Review only the proposed scope. The roadmap records product intent;
it does not authorize implementation of future milestones.

## Human control

Every PR starts as a draft. A human authorizes readiness, reviews the current
changes, and performs every merge after required checks pass. New changes
require renewed human review. Automatic merging is prohibited, including
merge-when-ready, automated merge queues, and merge API calls by agents.

Automated review and nursing are disabled. The stored
`review_only` request is a future capability preference, not activation or
write authority. Draft readiness remains disabled. PR scanning has no label
filter and retains a limit of 10 open PRs per scan. Selection grants no
permission. Changes to these settings, policy files, repository permissions,
or external integrations require explicit human review and separate
authorization for activation.

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
