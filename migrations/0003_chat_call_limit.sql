ALTER TABLE sessions
ADD COLUMN updated_chat_call_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_chat_call_count BETWEEN 0 AND 50);

UPDATE sessions SET updated_chat_call_count = chat_call_count;

ALTER TABLE sessions DROP COLUMN chat_call_count;

ALTER TABLE sessions RENAME COLUMN updated_chat_call_count TO chat_call_count;
