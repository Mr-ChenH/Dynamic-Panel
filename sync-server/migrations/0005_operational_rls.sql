-- Operational backup, restore, usage, and garbage-collection transactions set
-- an explicit local admin actor. These additive policies keep tenant requests
-- scoped while allowing the management plane to inspect all tenant rows.
CREATE FUNCTION operational_admin_allowed() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.admin_actor_id', true), '') <> ''
$$;

CREATE TABLE export_jobs (
  job_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  space_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('running','verified','failed')),
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (account_id,space_id) REFERENCES spaces(account_id,space_id) ON DELETE CASCADE
);
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY export_jobs_account ON export_jobs
  USING (account_id::text = current_setting('app.account_id', true))
  WITH CHECK (account_id::text = current_setting('app.account_id', true));
CREATE POLICY export_jobs_admin ON export_jobs
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());

CREATE POLICY account_sessions_admin ON account_sessions
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());
CREATE POLICY spaces_admin ON spaces
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());
CREATE POLICY clients_admin ON clients
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());
CREATE POLICY client_keys_admin ON client_key_generations
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());
CREATE POLICY audit_admin ON audit_events
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());

CREATE POLICY records_admin ON records
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());
CREATE POLICY versions_admin ON record_versions
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());
CREATE POLICY operations_admin ON operations
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());
CREATE POLICY conflicts_admin ON conflicts
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());
CREATE POLICY changes_admin ON changes
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());
CREATE POLICY floors_admin ON space_stream_floors
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());
CREATE POLICY category_state_admin ON category_state
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());

CREATE POLICY space_objects_admin ON space_objects
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());
CREATE POLICY object_upload_sessions_admin ON object_upload_sessions
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());
CREATE POLICY object_refs_admin ON object_refs
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());
CREATE POLICY object_usage_rollups_admin ON object_usage_rollups
  USING (operational_admin_allowed()) WITH CHECK (operational_admin_allowed());
