import { error, fail, isHttpError } from "@sveltejs/kit";
import { generateTurn, isRecord, limits } from "$lib/server/memory";
import {
  createSession,
  loadSession,
  reserveAiCall,
  resetConversation,
  saveTurn,
  sessionIdentifier,
  type SessionState,
} from "$lib/server/storage";
import {
  matchMemories,
  requireCurrentSnapshot,
  selectedResponse,
  traceMemory,
  type MemoryMatch,
} from "$lib/server/trace";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

const cookieName = "bisect_session";

function environmentFor(event: RequestEvent) {
  if (
    event.params.view !== undefined &&
    event.params.view !== "chat" &&
    event.params.view !== "memories"
  ) {
    error(404, "Not found");
  }
  if (!event.platform?.env) error(503, "The service is unavailable. Please try again later.");
  if (event.platform.env.MAINTENANCE_MODE === "true") {
    error(503, "Service temporarily unavailable.");
  }
  return event.platform.env;
}

function failure(cause: unknown, action: string, draft = "", reserved = false) {
  const status = isHttpError(cause) ? cause.status : 503;
  let message = isHttpError(cause)
    ? cause.body.message
    : "The request could not be completed. Refresh before trying again.";
  if (reserved) message += " This attempt used one AI call.";
  return fail(status, { action, error: message, draft });
}

export const load = (async event => {
  event.setHeaders({ "cache-control": "private, no-store" });
  const environment = environmentFor(event);
  let state: SessionState | null = null;
  let loadError = "";
  const identifier = sessionIdentifier(event.cookies.get(cookieName));

  if (identifier) {
    try {
      state = await loadSession(environment.DB, identifier);
      if (!state) event.cookies.delete(cookieName, { path: "/" });
    } catch (cause) {
      console.error("Failed to load saved conversation:", cause);
      loadError = "Your saved conversation could not be loaded. Please refresh.";
    }
  }

  return {
    session: state
      ? {
          revision: state.session.revision,
          conversationVersion: state.session.conversationVersion,
          expiresAt: state.session.expiresAt,
          remainingChatCalls: limits.chatCalls - state.session.chatCalls,
          remainingMatchingCalls: limits.matchingCalls - state.session.matchingCalls,
        }
      : null,
    messages: state?.messages ?? [],
    memories: state?.memories.filter(memory => memory.active) ?? [],
    siteKey: environment.TURNSTILE_SITE_KEY,
    inputCharacters: limits.inputCharacters,
    selectedCharacters: limits.selectedCharacters,
    loadError,
  };
}) satisfies PageServerLoad;

async function startSession(event: RequestEvent) {
  try {
    const environment = environmentFor(event);
    const previousIdentifier = sessionIdentifier(event.cookies.get(cookieName));

    if (previousIdentifier) {
      const existing = await loadSession(environment.DB, previousIdentifier);
      if (existing) return { action: "start", error: "", draft: "" };
    }

    const form = await event.request.formData();
    const token = form.get("turnstile_token");
    if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
      error(400, "Complete the verification before continuing.");
    }
    if (
      !environment.TURNSTILE_SITE_KEY ||
      !environment.TURNSTILE_SECRET_KEY ||
      !environment.TURNSTILE_HOSTNAME ||
      environment.TURNSTILE_HOSTNAME !== event.url.hostname
    ) {
      error(503, "Verification is not configured for this hostname.");
    }

    let verification: unknown;
    try {
      const response = await event.fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          body: new URLSearchParams({ secret: environment.TURNSTILE_SECRET_KEY, response: token }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) error(503, "Verification is unavailable. Please try again.");
      verification = await response.json();
    } catch {
      error(503, "Verification is unavailable. Please try again.");
    }

    if (
      !isRecord(verification) ||
      verification.success !== true ||
      verification.hostname !== environment.TURNSTILE_HOSTNAME ||
      verification.action !== "session"
    ) {
      error(400, "Verification failed or expired. Please complete a new challenge.");
    }

    const created = await createSession(
      environment.DB,
      previousIdentifier,
      event.platform?.cf?.country ?? null,
    );
    event.cookies.set(cookieName, created.identifier, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      expires: new Date(created.expiresAt * 1000),
    });
    return { action: "start", error: "", draft: "" };
  } catch (cause) {
    return failure(cause, "start");
  }
}

export const actions = {
  start: startSession,
  reset: async event => {
    try {
      const environment = environmentFor(event);
      const identifier = sessionIdentifier(event.cookies.get(cookieName));
      if (!identifier) error(401, "Your session expired. Refresh to start a new session.");
      await resetConversation(environment.DB, identifier);
      return { action: "reset", error: "", draft: "" };
    } catch (cause) {
      return failure(cause, "reset");
    }
  },
  chat: async event => {
    let draft = "";
    let reserved = false;

    try {
      const environment = environmentFor(event);
      const form = await event.request.formData();
      const submitted = form.get("message");
      if (typeof submitted !== "string") error(400, "Enter a message.");
      draft = submitted.slice(0, limits.inputCharacters);
      if (submitted.length > limits.inputCharacters) {
        error(400, `Messages must be ${limits.inputCharacters} characters or fewer.`);
      }
      const content = submitted;
      if (!content.trim()) error(400, "Enter a message.");

      const identifier = sessionIdentifier(event.cookies.get(cookieName));
      if (!identifier) error(401, "Start a verified session before sending a message.");
      const state = await loadSession(environment.DB, identifier);
      if (!state) {
        event.cookies.delete(cookieName, { path: "/" });
        error(401, "Your session expired. Please start a new session.");
      }

      await reserveAiCall(environment, state, "chat");
      reserved = true;
      const generated = await generateTurn(environment, state.messages, state.memories, content);
      await saveTurn(environment.DB, state, content, generated);
      return { action: "chat", error: "", draft: "" };
    } catch (cause) {
      return failure(cause, "chat", draft, reserved);
    }
  },
  match: async event => {
    let reserved = false;
    try {
      const { environment, state, message, question, selection } = await traceRequest(event);
      let candidates: MemoryMatch["candidates"] = [];
      if (state.memories.some(memory => memory.active)) {
        await reserveAiCall(environment, state, "match");
        reserved = true;
        candidates = await matchMemories(
          environment,
          selection,
          question.content,
          message.content,
          state.memories,
        );
      }
      await requireCurrentSnapshot(environment.DB, state);
      const match: MemoryMatch = {
        messageId: message.id,
        selection,
        revision: state.session.revision,
        conversationVersion: state.session.conversationVersion,
        candidates,
        trace:
          candidates.length === 1
            ? await traceMemory(environment.DB, state, message, candidates[0].id)
            : null,
      };
      return { action: "match", error: "", draft: "", match };
    } catch (cause) {
      return failure(cause, "match", "", reserved);
    }
  },
  trace: async event => {
    try {
      const { environment, state, form, message } = await traceRequest(event);
      if (
        form.get("revision") !== String(state.session.revision) ||
        form.get("conversation_version") !== String(state.session.conversationVersion)
      ) {
        error(409, "The conversation changed. Trace the reply again to start a new match.");
      }
      const identifier = form.get("memory_id");
      if (typeof identifier !== "string") error(400, "Choose a matching memory.");
      const trace = await traceMemory(environment.DB, state, message, identifier);
      return { action: "trace", error: "", draft: "", trace };
    } catch (cause) {
      return failure(cause, "trace");
    }
  },
} satisfies Actions;

async function traceRequest(event: RequestEvent) {
  const environment = environmentFor(event);
  const identifier = sessionIdentifier(event.cookies.get(cookieName));
  if (!identifier) error(401, "Your session expired. Refresh to continue.");
  const state = await loadSession(environment.DB, identifier);
  if (!state) error(401, "Your session expired. Refresh to continue.");
  const form = await event.request.formData();
  return { environment, state, form, ...selectedResponse(state, form) };
}
