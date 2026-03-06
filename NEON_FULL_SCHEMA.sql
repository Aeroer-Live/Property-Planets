-- Property Planets – full Neon schema (users + properties). Run once in Neon SQL Editor.

-- Users (Admin/Staff, Pending/Active/Rejected)
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Staff')),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Active', 'Rejected')),
  theme_preference TEXT NOT NULL DEFAULT 'light' CHECK (theme_preference IN ('light', 'dark')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by BIGINT REFERENCES users(id),
  approved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Properties (references users.id for created_by / updated_by)
CREATE TABLE IF NOT EXISTS properties (
  id BIGSERIAL PRIMARY KEY,
  property_name TEXT NOT NULL,
  property_owner_name TEXT NOT NULL,
  phone_01 TEXT NOT NULL,
  phone_02 TEXT,
  ic_number TEXT,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT REFERENCES users(id),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_properties_property_name ON properties(property_name);
CREATE INDEX IF NOT EXISTS idx_properties_property_owner_name ON properties(property_owner_name);
CREATE INDEX IF NOT EXISTS idx_properties_phone_01 ON properties(phone_01);
CREATE INDEX IF NOT EXISTS idx_properties_phone_02 ON properties(phone_02);
CREATE INDEX IF NOT EXISTS idx_properties_ic_number ON properties(ic_number);
CREATE INDEX IF NOT EXISTS idx_properties_created_by ON properties(created_by);
