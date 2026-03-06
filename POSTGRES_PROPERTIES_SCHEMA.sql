-- Property Planets - Postgres schema for "properties" (Neon / any Postgres).
-- Run this once in Neon SQL editor (or via psql) before switching the app to Postgres-backed properties.

CREATE TABLE IF NOT EXISTS properties (
  id BIGSERIAL PRIMARY KEY,
  property_name TEXT NOT NULL,
  property_owner_name TEXT NOT NULL,
  phone_01 TEXT NOT NULL,
  phone_02 TEXT,
  ic_number TEXT,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT,
  updated_at TIMESTAMPTZ
);

-- Basic indexes
CREATE INDEX IF NOT EXISTS idx_properties_property_name ON properties(property_name);
CREATE INDEX IF NOT EXISTS idx_properties_property_owner_name ON properties(property_owner_name);
CREATE INDEX IF NOT EXISTS idx_properties_phone_01 ON properties(phone_01);
CREATE INDEX IF NOT EXISTS idx_properties_phone_02 ON properties(phone_02);
CREATE INDEX IF NOT EXISTS idx_properties_ic_number ON properties(ic_number);
CREATE INDEX IF NOT EXISTS idx_properties_created_by ON properties(created_by);

-- Optional (recommended at large scale):
-- The app uses ILIKE with patterns like '%term%'. For tens of millions of rows, enable trigram indexes.
-- In Neon, pg_trgm is typically available. If CREATE EXTENSION is not allowed, enable it from Neon UI/DB settings.
--
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX IF NOT EXISTS idx_properties_property_name_trgm ON properties USING GIN (property_name gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS idx_properties_owner_trgm ON properties USING GIN (property_owner_name gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS idx_properties_phone01_trgm ON properties USING GIN (phone_01 gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS idx_properties_phone02_trgm ON properties USING GIN (phone_02 gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS idx_properties_ic_trgm ON properties USING GIN (ic_number gin_trgm_ops);

