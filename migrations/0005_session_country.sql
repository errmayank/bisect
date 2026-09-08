ALTER TABLE sessions
ADD COLUMN country TEXT CHECK (country IS NULL OR country GLOB '[A-Z][A-Z]');
