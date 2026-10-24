# Benchmark Issues (12 standardised tasks)

## Proposed demo target repo
**`sf-demo-todo-api`** — a small TypeScript service owned by Ray (public, MIT licence, so it's authorised by definition):
- Node 20 + TypeScript, Express, in-memory store with a repository interface, zod validation
- Vitest + supertest tests, ESLint + Prettier, `tsc --noEmit`
- GitHub Actions CI: `npm ci && npm run lint && npm run typecheck && npm test`
- ~10–15 source files, endpoints: `GET/POST /todos`, `GET/PATCH/DELETE /todos/:id`, `GET /health`
- Seeded deliberately with the bugs/gaps below. Reset to a tagged baseline (`bench-v1`) before each run so tasks are repeatable.

Difficulty: **S** (≤20 lines, one file) · **M** (multi-file, tests) · **L** (design choice, several files).
Global criteria for every task: CI green; no unrelated file changes; no new dependencies unless asked; PR description links the issue.

---

### B01 — Fix: `PATCH /todos/:id` returns 200 for missing todo `[bug] [S]`
**Body:** Patching a non-existent id returns 200 with `null`. It should return 404 `{ "error": "Todo not found" }`.
**Acceptance criteria:**
- [ ] 404 with that exact JSON body for unknown id
- [ ] Existing-todo behaviour unchanged
- [ ] New test covers the 404 case

### B02 — Fix: `GET /todos?limit=` ignores invalid values `[bug] [S]`
**Body:** `limit=abc` or `limit=-1` currently returns everything. Invalid limits should return 400; limit must be integer 1–100, default 20.
**Acceptance criteria:**
- [ ] 400 for non-integer, <1 or >100
- [ ] Default 20 when omitted
- [ ] Tests for valid, default and each invalid case

### B03 — Fix: `title` whitespace accepted `[bug] [S]`
**Body:** `POST /todos` accepts `"   "` as a title. Trim titles and reject empty results with 400.
**Acceptance criteria:**
- [ ] Titles stored trimmed
- [ ] Whitespace-only title → 400 via zod schema
- [ ] Tests added

### B04 — Feature: filter todos by `completed` `[feature] [M]`
**Body:** Support `GET /todos?completed=true|false`.
**Acceptance criteria:**
- [ ] Filters correctly for `true`/`false`; other values → 400
- [ ] Works together with `limit`
- [ ] Tests for both values and invalid input; README API section updated

### B05 — Feature: add `dueDate` field `[feature] [M]`
**Body:** Todos may have optional `dueDate` (ISO 8601 date). Accept on create/patch, return in responses.
**Acceptance criteria:**
- [ ] Optional, validated as ISO date; invalid → 400
- [ ] Type, schema, repository and responses updated
- [ ] Tests for valid, missing and invalid values

### B06 — Feature: `/health` includes version and uptime `[feature] [S]`
**Body:** `GET /health` should return `{ status: "ok", version, uptimeSeconds }`, version read from package.json.
**Acceptance criteria:**
- [ ] Response shape matches; `uptimeSeconds` is a non-negative integer
- [ ] Test asserts shape
- [ ] No new dependencies

### B07 — Tests: cover `TodoRepository` `[test] [M]`
**Body:** The in-memory repository has no unit tests.
**Acceptance criteria:**
- [ ] Unit tests for create, get, list, update, delete, not-found paths
- [ ] No production code changes (unless a real bug is found — then flagged in PR description)
- [ ] Repository file line coverage ≥90%

### B08 — Tests: add tests for `DELETE /todos/:id` `[test] [S]`
**Body:** Delete endpoint is untested.
**Acceptance criteria:**
- [ ] Tests for successful delete (204) and unknown id (404)
- [ ] Test verifies the item is gone afterwards
- [ ] Tests only

### B09 — Refactor: centralise error handling `[refactor] [L]`
**Body:** Route handlers each build error JSON inline. Introduce an `HttpError` class and one Express error middleware.
**Acceptance criteria:**
- [ ] All routes throw/forward `HttpError`; single middleware formats `{ error }`
- [ ] All existing tests pass unchanged (behaviour-preserving)
- [ ] Unknown errors → 500 without leaking stack traces

### B10 — Refactor: extract config module `[refactor] [S]`
**Body:** `process.env.PORT` and other env reads are scattered. Move to `src/config.ts` with typed defaults.
**Acceptance criteria:**
- [ ] No `process.env` reads outside `src/config.ts`
- [ ] Defaults preserved (PORT=3000)
- [ ] Typecheck and tests pass

### B11 — Chore: bump `zod` to latest patch/minor in current major `[dependency] [S]`
**Body:** Update zod within its current major version.
**Acceptance criteria:**
- [ ] `package.json` and lockfile updated consistently (no other packages bumped)
- [ ] CI green
- [ ] PR notes old → new version and links changelog

### B12 — Docs: document the API and local setup `[docs] [S]`
**Body:** README lacks setup and endpoint docs.
**Acceptance criteria:**
- [ ] Setup, run, test commands documented and accurate
- [ ] Every endpoint listed with method, path, example request/response
- [ ] No code changes

---
Mix: bug ×3, feature ×3, test ×2, refactor ×2, dependency ×1, docs ×1 · S ×8, M ×3, L ×1.
