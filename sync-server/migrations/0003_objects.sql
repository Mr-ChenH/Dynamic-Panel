CREATE TABLE physical_objects (
  physical_object_id uuid PRIMARY KEY DEFAULT uuid_v7(),
  storage_key text NOT NULL UNIQUE,
  digest char(71) NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  bytes bigint NOT NULL CHECK (bytes >= 0),
  mime_type text NOT NULL CHECK (mime_type = 'image/png'),
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE space_objects (
  account_id uuid NOT NULL,
  space_id uuid NOT NULL,
  object_id text NOT NULL DEFAULT ('obj_' || replace(replace(rtrim(encode(gen_random_bytes(18), 'base64'), '='), '+', '-'), '/', '_'))
    CHECK (object_id ~ '^obj_[A-Za-z0-9_-]{24}$'),
  physical_object_id uuid NOT NULL REFERENCES physical_objects(physical_object_id),
  digest char(71) NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  bytes bigint NOT NULL CHECK (bytes >= 0),
  mime_type text NOT NULL CHECK (mime_type = 'image/png'),
  purpose text NOT NULL CHECK (purpose IN ('note-image','clipboard-image','screenshot')),
  committed_at timestamptz NOT NULL DEFAULT now(),
  unreferenced_at timestamptz,
  retain_until timestamptz,
  PRIMARY KEY (account_id, space_id, object_id),
  FOREIGN KEY (account_id, space_id) REFERENCES spaces(account_id, space_id) ON DELETE CASCADE
);
CREATE INDEX space_objects_scope_digest_idx ON space_objects(account_id, space_id, digest);
CREATE INDEX space_objects_gc_idx ON space_objects(unreferenced_at, retain_until) WHERE unreferenced_at IS NOT NULL;

CREATE TABLE object_upload_sessions (
  upload_id text PRIMARY KEY DEFAULT ('upl_' || replace(replace(rtrim(encode(gen_random_bytes(18), 'base64'), '='), '+', '-'), '/', '_'))
    CHECK (upload_id ~ '^upl_[A-Za-z0-9_-]{24}$'),
  account_id uuid NOT NULL,
  space_id uuid NOT NULL,
  client_id uuid NOT NULL,
  expected_digest char(71) NOT NULL CHECK (expected_digest ~ '^sha256:[0-9a-f]{64}$'),
  expected_bytes bigint NOT NULL CHECK (expected_bytes >= 0),
  mime_type text NOT NULL CHECK (mime_type = 'image/png'),
  purpose text NOT NULL CHECK (purpose IN ('note-image','clipboard-image','screenshot')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completing','complete','cancelled','expired','failed')),
  object_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, space_id, client_id) REFERENCES clients(account_id, space_id, client_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, space_id, object_id) REFERENCES space_objects(account_id, space_id, object_id)
);
CREATE INDEX object_upload_sessions_active_idx ON object_upload_sessions(account_id, space_id, client_id, expires_at) WHERE status IN ('open','completing');

CREATE TABLE object_upload_parts (
  upload_id text NOT NULL REFERENCES object_upload_sessions(upload_id) ON DELETE CASCADE,
  part_number integer NOT NULL CHECK (part_number BETWEEN 1 AND 10000),
  storage_key text NOT NULL UNIQUE,
  digest char(71) NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 8388608),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (upload_id, part_number)
);

CREATE TABLE object_refs (
  account_id uuid NOT NULL,
  space_id uuid NOT NULL,
  reference_id text NOT NULL CHECK (char_length(reference_id) BETWEEN 1 AND 160),
  object_id text NOT NULL,
  retain_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, space_id, reference_id, object_id),
  FOREIGN KEY (account_id, space_id, object_id) REFERENCES space_objects(account_id, space_id, object_id) ON DELETE CASCADE
);
CREATE INDEX object_refs_object_idx ON object_refs(account_id, space_id, object_id);

CREATE TABLE object_usage_rollups (
  account_id uuid NOT NULL,
  space_id uuid NOT NULL,
  object_count bigint NOT NULL DEFAULT 0 CHECK (object_count >= 0),
  object_bytes bigint NOT NULL DEFAULT 0 CHECK (object_bytes >= 0),
  referenced_bytes bigint NOT NULL DEFAULT 0 CHECK (referenced_bytes >= 0),
  incomplete_uploads bigint NOT NULL DEFAULT 0 CHECK (incomplete_uploads >= 0),
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, space_id),
  FOREIGN KEY (account_id, space_id) REFERENCES spaces(account_id, space_id) ON DELETE CASCADE
);

ALTER TABLE space_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_objects FORCE ROW LEVEL SECURITY;
ALTER TABLE object_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE object_upload_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE object_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE object_refs FORCE ROW LEVEL SECURITY;
ALTER TABLE object_usage_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE object_usage_rollups FORCE ROW LEVEL SECURITY;

CREATE POLICY space_objects_scope ON space_objects USING (
  account_id::text = current_setting('app.account_id', true) AND space_id::text = current_setting('app.space_id', true)
) WITH CHECK (
  account_id::text = current_setting('app.account_id', true) AND space_id::text = current_setting('app.space_id', true)
);
CREATE POLICY object_upload_sessions_scope ON object_upload_sessions USING (
  account_id::text = current_setting('app.account_id', true) AND space_id::text = current_setting('app.space_id', true)
) WITH CHECK (
  account_id::text = current_setting('app.account_id', true) AND space_id::text = current_setting('app.space_id', true)
);
CREATE POLICY object_refs_scope ON object_refs USING (
  account_id::text = current_setting('app.account_id', true) AND space_id::text = current_setting('app.space_id', true)
) WITH CHECK (
  account_id::text = current_setting('app.account_id', true) AND space_id::text = current_setting('app.space_id', true)
);
CREATE POLICY object_usage_rollups_scope ON object_usage_rollups USING (
  account_id::text = current_setting('app.account_id', true) AND space_id::text = current_setting('app.space_id', true)
) WITH CHECK (
  account_id::text = current_setting('app.account_id', true) AND space_id::text = current_setting('app.space_id', true)
);

-- physical_objects and part rows are intentionally reachable only through scoped
-- metadata joins; application credentials receive no direct digest lookup policy.
