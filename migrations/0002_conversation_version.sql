ALTER TABLE sessions
ADD COLUMN conversation_version INTEGER NOT NULL DEFAULT 0 CHECK (conversation_version >= 0);
