-- Add IC Number to properties
ALTER TABLE properties ADD COLUMN ic_number TEXT;
CREATE INDEX idx_properties_ic_number ON properties(ic_number);
