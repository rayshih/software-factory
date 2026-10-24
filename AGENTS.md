# Repository instructions

## Scope

- Target repository: `rayshih/software-factory`. Default branch and Graphite trunk: `main`.
- Read `README.md`, `PLAN.md`, `SETUP.md`, and the relevant package scripts before changing behavior.
- Work only on the requested change. Do not enable scheduling, task dispatch, PR nursing, or webhooks without explicit authorization. Automatic merging is prohibited.
- Repository instructions and configuration do not grant write or merge authority.

## Repository map and principles

- `apps/control-plane/`: TypeScript ESM control-plane foundation, with Drizzle/Postgres persistence, SQL migrations, and Vitest tests. The complete issue-to-PR pipeline is not implemented yet; package dependencies and scripts alone are not evidence of working integrations.
- `docs/index.html` and `docs/zh-tw/index.html`: English and Traditional Chinese static landing pages. Keep product claims consistent across languages when changing them.
- `benchmarks/`: benchmark issues. `metrics/`: cost and prospect tracking. `content/`: public updates.
- `PLAN.md` is the product roadmap, not yet a concrete PM execution plan. Do not infer authorization to implement the whole roadmap.
- Integrate existing infrastructure, keep the agent runtime separate from the control plane, and preserve idempotency. Retries must not create duplicate tasks or PRs. An idle agent session is not proof of completion.
- Preserve auditability of cost, human interventions, and failure causes. Keep work focused on the requested slice.

## Local setup

Use Node.js 20 or newer (CI uses 20) and `pnpm@10.33.4`, as pinned in root `package.json`. Use pnpm and preserve `pnpm-lock.yaml`.

From the repository root:

```sh
pnpm install --frozen-lockfile
```

The workspace includes `apps/*`; the current package is `@software-factory/control-plane`. Tests use in-process PGlite and do not require a running Postgres server or live service credentials.

The package declares `dev`, `start`, `db:migrate`, `export:tasks`, `trigger:dev`, and `trigger:deploy`, but the server entrypoint, migration/export scripts, and Trigger configuration are not present yet. Do not treat these as working setup steps or invoke deployments as validation. Check the actual files before documenting or using them later.

Runtime configuration is defined in `apps/control-plane/src/config.ts`. Keep credentials in the authorized environment; never commit or print private keys, tokens, webhook secrets, or populated environment files. Local validation does not authorize contacting live GitHub, Trigger.dev, or Anthropic services.

## Validation

For control-plane code, dependency, or build-configuration changes, run from the root:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

- Root scripts delegate to `@software-factory/control-plane`. Lint runs ESLint and Prettier; tests run Vitest; build compiles TypeScript and copies SQL migrations.
- `.github/workflows/control-plane.yml` currently runs install, lint, typecheck, and tests in job `check`. Build is an additional local check. CI is path-filtered and does not run for every documentation change.
- For documentation-only changes, check accuracy, referenced paths, and `git diff --check`; do not claim application tests ran if they did not. Preview affected landing pages when changing their presentation.
- Add or update meaningful tests for behavior changes, especially idempotency, state transitions, persistence, and authorization boundaries.
- Report commands run, results, and any checks blocked by the environment. A skipped workflow is not a passing check.
- The existing Pages workflow deploys `docs/` on pushes to `main`; do not trigger deployment as part of setup or validation.

## Graphite and pull requests

- Graphite is already initialized with `main` as trunk. Do not reinitialize it or change the trunk.
- Before branch operations, inspect `git status`, `git remote -v`, and `gt log short`. Confirm the checkout belongs to `rayshih/software-factory`; preserve unrelated work.
- For future authorized implementation, start independent work from an up-to-date `main` using `gt checkout main` and `gt sync` in a clean checkout. Stack dependent slices on their intended parent branch.
- Use `gt create <branch-name> -m "<commit message>"` to create branches and commit explicitly staged files. Use `gt modify` for updates and `gt restack` when needed. Do not commit directly to `main` or bypass Graphite with a separate PR-creation workflow.
- Before submitting, run the relevant validation and inspect the diff and stack. `gt submit` can submit ancestors as well as the current branch; do not publish unrelated work.
- Create every PR as a draft with `gt submit --draft --no-interactive`. Never use `--publish` or `--merge-when-ready`. The `--draft` flag applies to new PRs; verify draft status rather than assuming it changes an existing PR.
- Keep PRs draft until a human explicitly authorizes readiness. Include the problem, scope, validation results, limitations, and stack dependencies in the PR description.
- Qualify GitHub commands with `--repo rayshih/software-factory` and identify PRs as `rayshih/software-factory#<number>` in cross-repository reports.

## Human approval and merge prohibition

- Every merge requires explicit human approval of the current changes and required checks passing. New changes after approval require renewed human review.
- Agents stop at a reviewable draft PR. A human controls readiness and performs the merge; agents must not invoke Graphite/GitHub merge commands or merge APIs, even after CI or AI review passes.
- Automatic merging is prohibited: no GitHub auto-merge, Graphite merge-when-ready, or automated merge queues. Do not enable these features or bypass branch protections.
- `SETUP.md` documents Forgeline installation and a `protect-main` ruleset for `rayshih/sf-demo-todo-api` only. Do not assume that installation, required `test` check, or protection applies to this repository. Do not expand `ALLOWED_REPOS` or install/activate an App without explicit authorization.
