-- Users table (Admin / Staff, Pending / Active / Rejected)
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Staff')),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Active', 'Rejected')),
  theme_preference TEXT NOT NULL DEFAULT 'light' CHECK (theme_preference IN ('light', 'dark')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT
);

CREATE UNIQUE INDEX idx_users_username ON users(username);
CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_role ON users(role);

-- Properties table with audit fields
CREATE TABLE properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_name TEXT NOT NULL,
  location TEXT NOT NULL,
  property_owner_name TEXT NOT NULL,
  phone_01 TEXT NOT NULL,
  phone_02 TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT
);

CREATE INDEX idx_properties_location ON properties(location);
CREATE INDEX idx_properties_property_name ON properties(property_name);
CREATE INDEX idx_properties_property_owner_name ON properties(property_owner_name);
CREATE INDEX idx_properties_phone_01 ON properties(phone_01);
CREATE INDEX idx_properties_phone_02 ON properties(phone_02);
CREATE INDEX idx_properties_created_by ON properties(created_by);
