CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  active_revision INTEGER NOT NULL DEFAULT 0 CHECK (active_revision >= 0),
  chat_call_count INTEGER NOT NULL DEFAULT 0 CHECK (chat_call_count BETWEEN 0 AND 10),
  matching_call_count INTEGER NOT NULL DEFAULT 0 CHECK (matching_call_count BETWEEN 0 AND 3),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_activity_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  CHECK (last_activity_at >= created_at),
  CHECK (expires_at > created_at),
  -- A session and its empty snapshot are created together in one D1 batch.
  FOREIGN KEY (id, active_revision) REFERENCES memory_snapshots (session_id, revision)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE INDEX sessions_expires_at ON sessions (expires_at);

CREATE TABLE messages (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(content) > 0),
  memory_revision INTEGER NOT NULL CHECK (memory_revision >= 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, sequence_number),
  FOREIGN KEY (session_id, memory_revision) REFERENCES memory_snapshots (session_id, revision)
) STRICT;

CREATE INDEX messages_memory_revision ON messages (session_id, memory_revision);

CREATE TABLE memory_snapshots (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  memory_json TEXT NOT NULL CHECK (json_valid(memory_json) AND json_type(memory_json) = 'array'),
  source_message_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (session_id, revision),
  UNIQUE (session_id, source_message_id),
  FOREIGN KEY (session_id, source_message_id) REFERENCES messages (session_id, id),
  CHECK (
    (revision = 0 AND source_message_id IS NULL AND json_array_length(memory_json) = 0)
    OR (revision > 0 AND source_message_id IS NOT NULL)
  )
) STRICT;

CREATE TRIGGER memory_snapshots_require_user_source
BEFORE INSERT ON memory_snapshots
WHEN NEW.source_message_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Memory snapshots must reference a user message from the same session')
  WHERE NOT EXISTS (
    SELECT 1 FROM messages
    WHERE session_id = NEW.session_id AND id = NEW.source_message_id AND role = 'user'
  );
END;

CREATE TRIGGER memory_snapshots_prevent_updates
BEFORE UPDATE ON memory_snapshots
BEGIN
  SELECT RAISE(ABORT, 'Memory snapshots are immutable');
END;

CREATE TABLE daily_usage (
  usage_date TEXT PRIMARY KEY NOT NULL CHECK (usage_date IS date(usage_date, '+0 days')),
  reserved_calls INTEGER NOT NULL DEFAULT 0 CHECK (reserved_calls BETWEEN 0 AND 60)
) STRICT;
