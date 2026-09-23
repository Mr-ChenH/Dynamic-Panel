-- Typed replication state. Application validation is the schema authority; SQL
-- enforces tenant ownership, ordering, retention metadata and replay uniqueness.
CREATE TABLE records (
  account_id uuid NOT NULL,
  space_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 240),
  category text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  revision bigint NOT NULL CHECK (revision > 0),
  payload jsonb,
  payload_bytes integer NOT NULL CHECK (payload_bytes >= 0 AND payload_bytes <= 1048576),
  deleted boolean NOT NULL DEFAULT false,
  origin_client_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_sequence bigint NOT NULL CHECK (last_sequence > 0),
  retain_until timestamptz,
  CONSTRAINT records_tombstone_retention CHECK (NOT deleted OR retain_until >= updated_at + interval '30 days'),
  PRIMARY KEY (account_id, space_id, entity_type, entity_id),
  FOREIGN KEY (account_id, space_id) REFERENCES spaces(account_id, space_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, space_id, origin_client_id) REFERENCES clients(account_id, space_id, client_id)
);
CREATE INDEX records_scope_category_idx ON records(account_id, space_id, category, entity_type, entity_id);
CREATE INDEX records_tombstone_retention_idx ON records(retain_until) WHERE deleted;

CREATE TABLE record_versions (
  account_id uuid NOT NULL,
  space_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  base_revision bigint NOT NULL CHECK (base_revision >= 0),
  operation_id text NOT NULL,
  category text NOT NULL,
  schema_version integer NOT NULL,
  payload jsonb,
  payload_bytes integer NOT NULL CHECK (payload_bytes >= 0 AND payload_bytes <= 1048576),
  deleted boolean NOT NULL,
  origin_client_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  retain_until timestamptz,
  CONSTRAINT record_versions_tombstone_retention CHECK (NOT deleted OR retain_until >= created_at + interval '30 days'),
  PRIMARY KEY (account_id, space_id, entity_type, entity_id, revision),
  UNIQUE (account_id, space_id, sequence),
  FOREIGN KEY (account_id, space_id) REFERENCES spaces(account_id, space_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, space_id, origin_client_id) REFERENCES clients(account_id, space_id, client_id)
);
CREATE INDEX record_versions_retention_idx ON record_versions(account_id, space_id, retain_until);

CREATE TABLE operations (
  account_id uuid NOT NULL,
  space_id uuid NOT NULL,
  client_id uuid NOT NULL,
  operation_id text NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 240),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, space_id, client_id, operation_id),
  FOREIGN KEY (account_id, space_id, client_id) REFERENCES clients(account_id, space_id, client_id) ON DELETE CASCADE
);
CREATE INDEX operations_retention_idx ON operations(account_id, space_id, created_at);

CREATE TABLE conflicts (
  account_id uuid NOT NULL,
  space_id uuid NOT NULL,
  conflict_id uuid NOT NULL DEFAULT uuid_v7(),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  category text NOT NULL,
  base_revision bigint NOT NULL CHECK (base_revision >= 0),
  current_revision bigint NOT NULL CHECK (current_revision >= 0),
  current_payload jsonb,
  incoming_payload jsonb,
  current_origin_client_id uuid,
  incoming_origin_client_id uuid NOT NULL,
  changed_fields text[] NOT NULL DEFAULT '{}',
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'unresolved' CHECK (status IN ('unresolved','resolved','purged')),
  resolution_revision bigint,
  sequence bigint NOT NULL CHECK (sequence > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  retain_until timestamptz NOT NULL CHECK (retain_until >= created_at + interval '30 days'),
  PRIMARY KEY (account_id, space_id, conflict_id),
  UNIQUE (account_id, space_id, sequence),
  FOREIGN KEY (account_id, space_id) REFERENCES spaces(account_id, space_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, space_id, incoming_origin_client_id) REFERENCES clients(account_id, space_id, client_id)
);
CREATE INDEX conflicts_unresolved_idx ON conflicts(account_id, space_id, created_at) WHERE status='unresolved';
CREATE INDEX conflicts_retention_idx ON conflicts(retain_until);

CREATE TABLE changes (
  account_id uuid NOT NULL,
  space_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_kind text NOT NULL CHECK (event_kind IN ('record','tombstone','restore','conflict','category_clear')),
  category text NOT NULL,
  entity_type text,
  entity_id text,
  revision bigint,
  conflict_id uuid,
  record_snapshot jsonb,
  conflict_snapshot jsonb,
  origin_client_id uuid NOT NULL,
  server_time timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, space_id, sequence),
  FOREIGN KEY (account_id, space_id) REFERENCES spaces(account_id, space_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, space_id, origin_client_id) REFERENCES clients(account_id, space_id, client_id)
);
CREATE INDEX changes_retention_idx ON changes(account_id, space_id, server_time);

CREATE TABLE space_stream_floors (
  account_id uuid NOT NULL,
  space_id uuid NOT NULL,
  restore_epoch bigint NOT NULL CHECK (restore_epoch > 0),
  minimum_sequence bigint NOT NULL DEFAULT 1 CHECK (minimum_sequence > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, space_id),
  FOREIGN KEY (account_id, space_id) REFERENCES spaces(account_id, space_id) ON DELETE CASCADE
);
INSERT INTO space_stream_floors(account_id,space_id,restore_epoch)
SELECT account_id,space_id,restore_epoch FROM spaces ON CONFLICT DO NOTHING;

CREATE TABLE category_state (
  account_id uuid NOT NULL,
  space_id uuid NOT NULL,
  category text NOT NULL,
  present boolean NOT NULL DEFAULT false,
  clear_generation bigint NOT NULL DEFAULT 0 CHECK (clear_generation >= 0),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, space_id, category),
  FOREIGN KEY (account_id, space_id) REFERENCES spaces(account_id, space_id) ON DELETE CASCADE
);

ALTER TABLE records ENABLE ROW LEVEL SECURITY; ALTER TABLE records FORCE ROW LEVEL SECURITY;
ALTER TABLE record_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE record_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE operations ENABLE ROW LEVEL SECURITY; ALTER TABLE operations FORCE ROW LEVEL SECURITY;
ALTER TABLE conflicts ENABLE ROW LEVEL SECURITY; ALTER TABLE conflicts FORCE ROW LEVEL SECURITY;
ALTER TABLE changes ENABLE ROW LEVEL SECURITY; ALTER TABLE changes FORCE ROW LEVEL SECURITY;
ALTER TABLE space_stream_floors ENABLE ROW LEVEL SECURITY; ALTER TABLE space_stream_floors FORCE ROW LEVEL SECURITY;
ALTER TABLE category_state ENABLE ROW LEVEL SECURITY; ALTER TABLE category_state FORCE ROW LEVEL SECURITY;

CREATE FUNCTION replication_scope_allowed(row_account uuid, row_space uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT row_account::text = current_setting('app.account_id', true)
  AND row_space::text = current_setting('app.space_id', true) $$;
CREATE POLICY records_scope ON records USING (replication_scope_allowed(account_id,space_id)) WITH CHECK (replication_scope_allowed(account_id,space_id));
CREATE POLICY versions_scope ON record_versions USING (replication_scope_allowed(account_id,space_id)) WITH CHECK (replication_scope_allowed(account_id,space_id));
CREATE POLICY operations_scope ON operations USING (replication_scope_allowed(account_id,space_id) AND client_id::text=current_setting('app.client_id',true)) WITH CHECK (replication_scope_allowed(account_id,space_id) AND client_id::text=current_setting('app.client_id',true));
CREATE POLICY conflicts_scope ON conflicts USING (replication_scope_allowed(account_id,space_id)) WITH CHECK (replication_scope_allowed(account_id,space_id));
CREATE POLICY changes_scope ON changes USING (replication_scope_allowed(account_id,space_id)) WITH CHECK (replication_scope_allowed(account_id,space_id));
CREATE POLICY floors_scope ON space_stream_floors USING (replication_scope_allowed(account_id,space_id)) WITH CHECK (replication_scope_allowed(account_id,space_id));
CREATE POLICY category_state_scope ON category_state USING (replication_scope_allowed(account_id,space_id)) WITH CHECK (replication_scope_allowed(account_id,space_id));

CREATE FUNCTION notify_sync_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE epoch bigint;
BEGIN
  SELECT restore_epoch INTO epoch FROM spaces WHERE account_id=NEW.account_id AND space_id=NEW.space_id;
  PERFORM pg_notify('sync_invalidation', json_build_object('accountId',NEW.account_id,'spaceId',NEW.space_id,'sequence',NEW.sequence,'restoreEpoch',epoch)::text);
  RETURN NEW;
END $$;
CREATE TRIGGER changes_invalidate AFTER INSERT ON changes FOR EACH ROW EXECUTE FUNCTION notify_sync_invalidation();

CREATE FUNCTION initialize_space_stream_floor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO space_stream_floors(account_id,space_id,restore_epoch) VALUES(NEW.account_id,NEW.space_id,NEW.restore_epoch) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER spaces_initialize_stream AFTER INSERT ON spaces FOR EACH ROW EXECUTE FUNCTION initialize_space_stream_floor();
