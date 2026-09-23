CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE FUNCTION uuid_v7() RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  value bytea := gen_random_bytes(16);
  unix_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
BEGIN
  value := set_byte(value, 0, ((unix_ms >> 40) & 255)::integer);
  value := set_byte(value, 1, ((unix_ms >> 32) & 255)::integer);
  value := set_byte(value, 2, ((unix_ms >> 24) & 255)::integer);
  value := set_byte(value, 3, ((unix_ms >> 16) & 255)::integer);
  value := set_byte(value, 4, ((unix_ms >> 8) & 255)::integer);
  value := set_byte(value, 5, (unix_ms & 255)::integer);
  value := set_byte(value, 6, (112 | (get_byte(value, 6) & 15))::integer);
  value := set_byte(value, 8, (128 | (get_byte(value, 8) & 63))::integer);
  RETURN encode(value, 'hex')::uuid;
END $$;

CREATE TABLE server_instance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  instance_id uuid NOT NULL DEFAULT uuid_v7(),
  protocol_min integer NOT NULL DEFAULT 1 CHECK (protocol_min > 0),
  protocol_max integer NOT NULL DEFAULT 1 CHECK (protocol_max >= protocol_min),
  record_schema_min integer NOT NULL DEFAULT 1 CHECK (record_schema_min > 0),
  record_schema_max integer NOT NULL DEFAULT 1 CHECK (record_schema_max >= record_schema_min),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO server_instance(singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE accounts (
  account_id uuid PRIMARY KEY DEFAULT uuid_v7(),
  username text NOT NULL,
  normalized_username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','deleting')),
  must_change_password boolean NOT NULL DEFAULT false,
  auth_epoch bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE account_sessions (
  session_id uuid PRIMARY KEY DEFAULT uuid_v7(),
  account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  token_fingerprint text NOT NULL UNIQUE,
  csrf_fingerprint text NOT NULL,
  auth_epoch bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  recent_auth_at timestamptz,
  revoked_at timestamptz,
  ip_prefix text,
  user_agent text
);
CREATE INDEX account_sessions_account_idx ON account_sessions(account_id, created_at DESC);

CREATE TABLE spaces (
  account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  space_id uuid NOT NULL DEFAULT uuid_v7(),
  name text NOT NULL,
  normalized_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','deleting','purged')),
  restore_epoch bigint NOT NULL DEFAULT 1,
  next_sequence bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  recoverable_until timestamptz,
  PRIMARY KEY (account_id, space_id)
);
CREATE UNIQUE INDEX spaces_account_name_live_uq ON spaces(account_id, normalized_name) WHERE status <> 'purged';
CREATE INDEX spaces_account_status_idx ON spaces(account_id, status);

CREATE TABLE clients (
  account_id uuid NOT NULL,
  space_id uuid NOT NULL,
  client_id uuid NOT NULL DEFAULT uuid_v7(),
  short_id char(6) NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  installation_id uuid,
  first_connected_at timestamptz,
  platform text,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (account_id, space_id, client_id),
  UNIQUE (account_id, space_id, short_id),
  FOREIGN KEY (account_id, space_id) REFERENCES spaces(account_id, space_id) ON DELETE CASCADE
);
CREATE INDEX clients_scope_status_idx ON clients(account_id, space_id, status);

CREATE TABLE client_key_generations (
  generation_id uuid PRIMARY KEY DEFAULT uuid_v7(),
  account_id uuid NOT NULL,
  space_id uuid NOT NULL,
  client_id uuid NOT NULL,
  lookup_fingerprint text NOT NULL UNIQUE,
  verifier text NOT NULL,
  auth_epoch bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  FOREIGN KEY (account_id, space_id, client_id)
    REFERENCES clients(account_id, space_id, client_id) ON DELETE CASCADE
);
CREATE INDEX client_key_generations_client_idx ON client_key_generations(account_id, space_id, client_id, created_at DESC);

CREATE TABLE audit_events (
  event_id uuid PRIMARY KEY DEFAULT uuid_v7(),
  account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  space_id uuid,
  client_id uuid,
  actor_type text NOT NULL CHECK (actor_type IN ('account','client','admin','system')),
  actor_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id_prefix text,
  result text NOT NULL CHECK (result IN ('success','failure')),
  error_code text,
  request_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, space_id) REFERENCES spaces(account_id, space_id) ON DELETE CASCADE
);
CREATE INDEX audit_events_account_time_idx ON audit_events(account_id, occurred_at DESC);

CREATE TABLE structural_limits (
  account_id uuid PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
  active_spaces integer NOT NULL DEFAULT 10 CHECK (active_spaces BETWEEN 1 AND 10),
  active_clients_per_space integer NOT NULL DEFAULT 10 CHECK (active_clients_per_space BETWEEN 1 AND 10)
);

ALTER TABLE account_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE spaces FORCE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;
ALTER TABLE client_key_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_key_generations FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY account_sessions_scope ON account_sessions
  USING (account_id::text = current_setting('app.account_id', true)
    OR token_fingerprint = current_setting('app.session_fingerprint', true))
  WITH CHECK (account_id::text = current_setting('app.account_id', true));
CREATE POLICY spaces_scope ON spaces
  USING (account_id::text = current_setting('app.account_id', true))
  WITH CHECK (account_id::text = current_setting('app.account_id', true));
CREATE POLICY clients_scope ON clients
  USING (account_id::text = current_setting('app.account_id', true)
    AND (nullif(current_setting('app.space_id', true), '') IS NULL OR space_id::text = current_setting('app.space_id', true)))
  WITH CHECK (account_id::text = current_setting('app.account_id', true)
    AND (nullif(current_setting('app.space_id', true), '') IS NULL OR space_id::text = current_setting('app.space_id', true)));
CREATE POLICY client_keys_scope ON client_key_generations
  USING ((account_id::text = current_setting('app.account_id', true)
    AND (nullif(current_setting('app.space_id', true), '') IS NULL OR space_id::text = current_setting('app.space_id', true)))
    OR lookup_fingerprint = current_setting('app.key_fingerprint', true))
  WITH CHECK (account_id::text = current_setting('app.account_id', true)
    AND (nullif(current_setting('app.space_id', true), '') IS NULL OR space_id::text = current_setting('app.space_id', true)));
CREATE POLICY audit_scope ON audit_events
  USING (account_id::text = current_setting('app.account_id', true))
  WITH CHECK (account_id::text = current_setting('app.account_id', true));

-- Limit checks serialize on the owning account/space row. Application transactions
-- lock the same rows before inserts; these triggers preserve the invariant for CLI use.
CREATE FUNCTION enforce_active_space_limit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    PERFORM 1 FROM accounts WHERE account_id = NEW.account_id FOR UPDATE;
    IF (SELECT count(*) FROM spaces WHERE account_id = NEW.account_id AND status = 'active') >=
       COALESCE((SELECT active_spaces FROM structural_limits WHERE account_id = NEW.account_id), 10) THEN
      RAISE EXCEPTION 'active space limit reached' USING ERRCODE = 'P0001', CONSTRAINT = 'active_space_limit';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER spaces_active_limit BEFORE INSERT OR UPDATE OF status ON spaces
  FOR EACH ROW EXECUTE FUNCTION enforce_active_space_limit();

CREATE FUNCTION enforce_active_client_limit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    PERFORM 1 FROM spaces WHERE account_id = NEW.account_id AND space_id = NEW.space_id FOR UPDATE;
    IF (SELECT count(*) FROM clients WHERE account_id = NEW.account_id AND space_id = NEW.space_id AND status = 'active') >=
       COALESCE((SELECT active_clients_per_space FROM structural_limits WHERE account_id = NEW.account_id), 10) THEN
      RAISE EXCEPTION 'active client limit reached' USING ERRCODE = 'P0001', CONSTRAINT = 'active_client_limit';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER clients_active_limit BEFORE INSERT OR UPDATE OF status ON clients
  FOR EACH ROW EXECUTE FUNCTION enforce_active_client_limit();
