-- Remove location column and index from properties
DROP INDEX IF EXISTS idx_properties_location;
ALTER TABLE properties DROP COLUMN location;
