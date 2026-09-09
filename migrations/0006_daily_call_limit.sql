ALTER TABLE daily_usage
ADD COLUMN updated_reserved_calls INTEGER NOT NULL DEFAULT 0 CHECK (updated_reserved_calls BETWEEN 0 AND 5000);

UPDATE daily_usage SET updated_reserved_calls = reserved_calls;

ALTER TABLE daily_usage DROP COLUMN reserved_calls;

ALTER TABLE daily_usage RENAME COLUMN updated_reserved_calls TO reserved_calls;
