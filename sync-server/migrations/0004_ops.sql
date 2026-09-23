-- Operational state is deliberately separate from backup artifacts and credentials.
CREATE TABLE backup_jobs (
  job_id uuid PRIMARY KEY DEFAULT uuid_v7(),
  kind text NOT NULL CHECK (kind IN ('backup','verify','restore_stage','restore_apply','export','import','drill','cleanup')),
  status text NOT NULL CHECK (status IN ('queued','running','verifying','verified','failed')),
  target_alias text,
  manifest_id uuid,
  scope_type text CHECK (scope_type IN ('server','account','space')),
  account_id uuid REFERENCES accounts(account_id) ON DELETE SET NULL,
  space_id uuid,
  reason text NOT NULL DEFAULT 'scheduled',
  bytes bigint CHECK (bytes IS NULL OR bytes >= 0),
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, space_id) REFERENCES spaces(account_id, space_id) ON DELETE SET NULL
);
CREATE INDEX backup_jobs_created_idx ON backup_jobs(created_at DESC);
CREATE INDEX backup_jobs_verified_idx ON backup_jobs(completed_at DESC) WHERE status = 'verified';

CREATE TABLE restore_stages (
  stage_id uuid PRIMARY KEY DEFAULT uuid_v7(),
  manifest_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('staging','ready','failed','applied')),
  staging_locator text NOT NULL,
  report jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  applied_at timestamptz
);

-- Verified restore data is staged separately from online tenant tables. Activation
-- consumes these rows in one scoped transaction; staging itself cannot mutate live data.
CREATE TABLE restore_stage_payloads (
  stage_id uuid PRIMARY KEY REFERENCES restore_stages(stage_id) ON DELETE CASCADE,
  payload jsonb NOT NULL
);
CREATE TABLE restore_stage_objects (
  stage_id uuid NOT NULL REFERENCES restore_stages(stage_id) ON DELETE CASCADE,
  artifact_index integer NOT NULL CHECK (artifact_index >= 0),
  metadata jsonb NOT NULL,
  body bytea NOT NULL,
  PRIMARY KEY (stage_id, artifact_index)
);

CREATE TABLE operational_alerts (
  alert_id uuid PRIMARY KEY DEFAULT uuid_v7(),
  code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warning','critical')),
  component text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX operational_alerts_active_idx ON operational_alerts(last_seen_at DESC) WHERE resolved_at IS NULL;
