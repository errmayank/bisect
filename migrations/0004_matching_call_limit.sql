ALTER TABLE sessions
ADD COLUMN updated_matching_call_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_matching_call_count BETWEEN 0 AND 25);

UPDATE sessions SET updated_matching_call_count = matching_call_count;

ALTER TABLE sessions DROP COLUMN matching_call_count;

ALTER TABLE sessions RENAME COLUMN updated_matching_call_count TO matching_call_count;
