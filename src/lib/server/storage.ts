import { error } from "@sveltejs/kit";
import { limits, readMemories, type ConversationMessage, type Memory } from "./memory";

interface Session {
  id: string;
  conversationVersion: number;
  revision: number;
  chatCalls: number;
  matchingCalls: number;
  expiresAt: number;
  memoryJson: string;
}

export interface StoredMessage extends ConversationMessage {
  id: string;
  sequence: number;
  memoryRevision: number;
  savedRevision: number | null;
}

export interface SessionState {
  session: Session;
  messages: StoredMessage[];
  memories: Memory[];
}

export function sessionIdentifier(value: string | undefined) {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
    ? value
    : null;
}

export async function loadSession(
  database: D1Database,
  identifier: string,
): Promise<SessionState | null> {
  const [sessionResult, messageResult] = await database.batch<Session | StoredMessage>([
    database
      .prepare(
        `SELECT sessions.id, conversation_version AS conversationVersion,
          active_revision AS revision, chat_call_count AS chatCalls,
          matching_call_count AS matchingCalls,
          expires_at AS expiresAt, memory_json AS memoryJson
         FROM sessions JOIN memory_snapshots
          ON memory_snapshots.session_id = sessions.id
          AND memory_snapshots.revision = sessions.active_revision
         WHERE sessions.id = ? AND expires_at > ?`,
      )
      .bind(identifier, Math.floor(Date.now() / 1000)),
    database
      .prepare(
        `SELECT messages.id, messages.sequence_number AS sequence, messages.role, messages.content,
          messages.memory_revision AS memoryRevision, saved.revision AS savedRevision
         FROM messages
         LEFT JOIN messages AS source
          ON source.session_id = messages.session_id
          AND source.sequence_number = messages.sequence_number - 1
          AND source.role = 'user' AND messages.role = 'assistant'
         LEFT JOIN memory_snapshots AS saved
          ON saved.session_id = source.session_id AND saved.source_message_id = source.id
         WHERE messages.session_id = ? ORDER BY messages.sequence_number`,
      )
      .bind(identifier),
  ]);

  const session = sessionResult.results[0] as Session | undefined;
  if (!session) return null;
  return {
    session,
    messages: messageResult.results as StoredMessage[],
    memories: readMemories(session.memoryJson),
  };
}

export async function createSession(database: D1Database, previousIdentifier: string | null) {
  const identifier = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  const expiresAt = timestamp + limits.sessionSeconds;
  const statements = [
    database
      .prepare(
        `INSERT INTO sessions (id, created_at, last_activity_at, expires_at) VALUES (?, ?, ?, ?)`,
      )
      .bind(identifier, timestamp, timestamp, expiresAt),
    database
      .prepare(
        `INSERT INTO memory_snapshots (session_id, revision, memory_json) VALUES (?, 0, '[]')`,
      )
      .bind(identifier),
  ];

  if (previousIdentifier) {
    statements.push(database.prepare(`DELETE FROM sessions WHERE id = ?`).bind(previousIdentifier));
  }
  statements.push(
    database
      .prepare(
        `DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE expires_at <= ? LIMIT 100)`,
      )
      .bind(timestamp),
  );

  await database.batch(statements);
  return { identifier, expiresAt };
}

export async function resetConversation(database: D1Database, identifier: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const results = await database.batch([
    // Messages and snapshots reference each other, so validate their removal at commit.
    database.prepare("PRAGMA defer_foreign_keys = ON"),
    database
      .prepare(
        `UPDATE sessions
         SET active_revision = 0, conversation_version = conversation_version + 1,
          last_activity_at = MAX(last_activity_at, ?)
         WHERE id = ? AND expires_at > ? RETURNING id`,
      )
      .bind(timestamp, identifier, timestamp),
    database
      .prepare(
        `DELETE FROM messages WHERE session_id = ?
         AND EXISTS (SELECT 1 FROM sessions WHERE id = messages.session_id AND expires_at > ?)`,
      )
      .bind(identifier, timestamp),
    database
      .prepare(
        `DELETE FROM memory_snapshots WHERE session_id = ?
         AND EXISTS (SELECT 1 FROM sessions WHERE id = memory_snapshots.session_id AND expires_at > ?)`,
      )
      .bind(identifier, timestamp),
    database
      .prepare(
        `INSERT INTO memory_snapshots (session_id, revision, memory_json, created_at)
         SELECT id, 0, '[]', ? FROM sessions WHERE id = ? AND expires_at > ?`,
      )
      .bind(timestamp, identifier, timestamp),
  ]);

  if (!results[1].results.length) {
    error(401, "Your session expired. Refresh to start a new session.");
  }
}

export async function reserveAiCall(
  environment: Cloudflare.Env,
  state: SessionState,
  kind: "chat" | "match",
) {
  const column = kind === "chat" ? "chat_call_count" : "matching_call_count";
  const allowance = kind === "chat" ? limits.chatCalls : limits.matchingCalls;
  const usedCalls = kind === "chat" ? state.session.chatCalls : state.session.matchingCalls;
  const exhausted =
    kind === "chat"
      ? "This session has no messages remaining."
      : "This session has no memory matches remaining.";
  if (usedCalls >= allowance) {
    error(429, exhausted);
  }
  const { success } = await environment.AI_RATE_LIMITER.limit({
    key: `bisect:${state.session.id}`,
  });
  if (!success) error(429, "Too many requests. Please wait a minute before sending again.");

  const timestamp = Math.floor(Date.now() / 1000);
  const usageDate = new Date(timestamp * 1000).toISOString().slice(0, 10);
  let results: D1Result[];
  try {
    // The counter CHECK constraints abort the entire batch if either allowance is exhausted.
    results = await environment.DB.batch([
      environment.DB.prepare(
        `UPDATE sessions
         SET ${column} = ${column} + 1, last_activity_at = MAX(last_activity_at, ?)
         WHERE id = ? AND expires_at > ? AND conversation_version = ? AND active_revision = ?
         RETURNING ${column}`,
      ).bind(
        timestamp,
        state.session.id,
        timestamp,
        state.session.conversationVersion,
        state.session.revision,
      ),
      environment.DB.prepare(
        `INSERT INTO daily_usage (usage_date, reserved_calls)
         SELECT ?, 1 WHERE EXISTS (
           SELECT 1 FROM sessions WHERE id = ? AND expires_at > ?
            AND conversation_version = ? AND active_revision = ?
         )
         ON CONFLICT (usage_date) DO UPDATE SET reserved_calls = daily_usage.reserved_calls + 1
         RETURNING reserved_calls`,
      ).bind(
        usageDate,
        state.session.id,
        timestamp,
        state.session.conversationVersion,
        state.session.revision,
      ),
    ]);
  } catch {
    const [session, daily] = await environment.DB.batch<{ usedCalls: number }>([
      environment.DB.prepare(
        `SELECT ${column} AS usedCalls FROM sessions WHERE id = ? AND expires_at > ?`,
      ).bind(state.session.id, timestamp),
      environment.DB.prepare(
        `SELECT reserved_calls AS usedCalls FROM daily_usage WHERE usage_date = ?`,
      ).bind(usageDate),
    ]);
    if (!session.results.length) error(401, "Your session expired. Please refresh.");
    if (session.results[0].usedCalls >= allowance) {
      error(429, exhausted);
    }
    if ((daily.results[0]?.usedCalls ?? 0) >= limits.dailyCalls) {
      error(429, "Today's shared AI allowance is used up. It resets at midnight UTC.");
    }
    error(503, "Could not reserve an AI call. Please try again.");
  }

  if (!results[0].results.length || !results[1].results.length) {
    error(409, "The conversation changed or expired. Refresh and try again.");
  }
}

export async function saveTurn(
  database: D1Database,
  state: SessionState,
  content: string,
  generated: { reply: string; memories: Memory[] },
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const userIdentifier = crypto.randomUUID();
  const assistantIdentifier = crypto.randomUUID();
  const lastSequence = state.messages.at(-1)?.sequence ?? 0;
  const revision = state.session.revision + 1;

  // Every later write depends on this insert so a stale or expired session cannot leave a partial turn.
  const statements = [
    database
      .prepare(
        `INSERT INTO messages (session_id, id, sequence_number, role, content, memory_revision, created_at)
         SELECT id, ?, ?, 'user', ?, active_revision, ? FROM sessions
         WHERE id = ? AND conversation_version = ? AND active_revision = ? AND expires_at > ?
          AND (SELECT COALESCE(MAX(sequence_number), 0) FROM messages WHERE session_id = sessions.id) = ?
         RETURNING id`,
      )
      .bind(
        userIdentifier,
        lastSequence + 1,
        content,
        timestamp,
        state.session.id,
        state.session.conversationVersion,
        state.session.revision,
        timestamp,
        lastSequence,
      ),
    // The new snapshot needs its source user message before the assistant can reference it.
    database
      .prepare(
        `INSERT INTO memory_snapshots (session_id, revision, memory_json, source_message_id, created_at)
         SELECT session_id, ?, ?, id, ? FROM messages WHERE session_id = ? AND id = ?`,
      )
      .bind(
        revision,
        JSON.stringify(generated.memories),
        timestamp,
        state.session.id,
        userIdentifier,
      ),
    database
      .prepare(
        `INSERT INTO messages (session_id, id, sequence_number, role, content, memory_revision, created_at)
         SELECT session_id, ?, ?, 'assistant', ?, ?, ? FROM messages
         WHERE session_id = ? AND id = ? RETURNING id`,
      )
      .bind(
        assistantIdentifier,
        lastSequence + 2,
        generated.reply,
        revision,
        timestamp,
        state.session.id,
        userIdentifier,
      ),
    database
      .prepare(
        `UPDATE sessions SET active_revision = ?, last_activity_at = MAX(last_activity_at, ?)
         WHERE id = ? AND EXISTS (SELECT 1 FROM messages WHERE session_id = sessions.id AND id = ?)`,
      )
      .bind(revision, timestamp, state.session.id, userIdentifier),
  ];

  let results: D1Result[];
  try {
    results = await database.batch(statements);
  } catch {
    error(503, "Could not confirm that this turn was saved. Refresh before resending.");
  }
  if (!results[0].results.length) {
    error(
      409,
      "The session changed or expired while the reply was being generated. Refresh before resending.",
    );
  }
}
