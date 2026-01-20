BEGIN;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL,
  applied_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_case (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS test_data (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  version TEXT NOT NULL,
  content_json JSONB NOT NULL,
  checksum TEXT,
  tags_json JSONB,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS test_case_data (
  id BIGSERIAL PRIMARY KEY,
  test_case_id BIGINT NOT NULL REFERENCES test_case(id) ON DELETE CASCADE,
  test_data_id BIGINT NOT NULL REFERENCES test_data(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('input','expected ,'  role TEXT NOT NULL version_pin TEXT,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_case_key ON test_case(key);
CREATE INDEX IF NOT EXISTS idx_test_data_key_ver ON test_data(key, version);
CREATE INDEX IF NOT EXISTS idx_tcd_case ON test_case_data(test_case_id);
CREATE INDEX IF NOT EXISTS idx_tcd_data ON test_case_data(test_data_id);
CREATE INDEX IF NOT EXISTS idx_tcd_role ON test_case_data(role);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tcd_case_data_role_ver
  ON test_case_data(test_case_id, test_data_id, role, COALESCE(version_pin, ''));

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tc_updated_at') THEN
    CREATE TRIGGER trg_tc_updated_at
    BEFORE UPDATE ON test_case
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_td_updated_at') THEN
    CREATE TRIGGER trg_td_updated_at
    BEFORE UPDATE ON test_data
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END$$;

INSERT INTO schema_version(version) VALUES (1)
ON CONFLICT DO NOTHING;

COMMIT;
