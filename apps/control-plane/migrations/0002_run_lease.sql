-- Run lease. A worker owns a task only while its run id is current.
-- An expired lease can be taken by another worker. Applied after 0001_init.sql.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS run_id text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
