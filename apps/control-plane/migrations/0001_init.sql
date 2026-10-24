-- Control-plane schema. Applied in filename order by src/db/migrate.ts.
-- Idempotent so a crashed apply can be retried before it is recorded.

DO $$
BEGIN
  CREATE TYPE task_status AS ENUM (
    'queued',
    'running',
    'pr_opened',
    'ci_passed',
    'ci_failed',
    'needs_human',
    'accepted',
    'rejected',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY,
  repo text NOT NULL,
  issue_number integer NOT NULL,
  status task_status NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  attempt_group integer NOT NULL,
  branch text NOT NULL,
  pr_number integer,
  pr_url text,
  attempts integer NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  tokens integer NOT NULL DEFAULT 0,
  interventions integer NOT NULL DEFAULT 0,
  human_intervention_minutes integer NOT NULL DEFAULT 0,
  ci_result text,
  review_outcome text,
  failure_reason text,
  failure_category text,
  installation_id integer NOT NULL,
  issue_title text NOT NULL DEFAULT '',
  issue_body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT tasks_attempt_group_positive CHECK (attempt_group >= 1),
  CONSTRAINT tasks_attempts_nonnegative CHECK (attempts >= 0),
  CONSTRAINT tasks_cost_nonnegative CHECK (cost_usd >= 0),
  CONSTRAINT tasks_tokens_nonnegative CHECK (tokens >= 0),
  CONSTRAINT tasks_interventions_nonnegative CHECK (interventions >= 0),
  CONSTRAINT tasks_minutes_nonnegative CHECK (human_intervention_minutes >= 0),
  CONSTRAINT tasks_idempotency_key_format CHECK (
    idempotency_key = repo || '#' || issue_number::text || '#' || attempt_group::text
  )
);

-- One in-flight task per issue. A new attempt group is allowed only after the
-- previous task reaches a terminal status (accepted, rejected, failed).
CREATE UNIQUE INDEX IF NOT EXISTS tasks_one_active_per_issue
  ON tasks (repo, issue_number)
  WHERE status IN (
    'queued',
    'running',
    'pr_opened',
    'ci_passed',
    'ci_failed',
    'needs_human'
  );

CREATE INDEX IF NOT EXISTS tasks_repo_issue_idx ON tasks (repo, issue_number);
CREATE INDEX IF NOT EXISTS tasks_branch_idx ON tasks (repo, branch);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id text PRIMARY KEY,
  event_name text NOT NULL,
  action text,
  repo text,
  status text NOT NULL,
  disposition text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_deliveries_status_check CHECK (status IN ('processing', 'processed', 'failed'))
);

CREATE TABLE IF NOT EXISTS task_events (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks (id),
  type text NOT NULL,
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_events_task_id_created_at_idx
  ON task_events (task_id, created_at);
