<script lang="ts">
  import { deserialize } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { onMount, tick } from "svelte";
  import type { StoredMessage } from "$lib/server/storage";
  import type { MemoryMatch, MemoryTrace } from "$lib/server/trace";

  let {
    messages,
    transcript,
    session,
    active,
    disabled,
    selectionLimit,
    onView,
  }: {
    messages: StoredMessage[];
    transcript: HTMLDivElement | undefined;
    session: {
      revision: number;
      conversationVersion: number;
      remainingMatchingCalls: number;
    } | null;
    active: boolean;
    disabled: boolean;
    selectionLimit: number;
    onView: (identifier: string) => Promise<void>;
  } = $props();

  interface SelectionText {
    messageId: string;
    text: string;
  }
  let floating = $state<(SelectionText & { left: number; top: number }) | null>(null);
  let selected = $state<SelectionText | null>(null);
  let match = $state<MemoryMatch | null>(null);
  let result = $state<MemoryTrace | null>(null);
  let feedback = $state("");
  let pending = $state<"match" | "trace" | null>(null);
  let dialog = $state<HTMLDialogElement>();
  let traceButton = $state<HTMLButtonElement>();
  let requestNumber = 0;

  function readSelection() {
    if (dialog?.open) return;
    const selection = document.getSelection();
    if (!active || disabled || !selection || selection.isCollapsed || selection.rangeCount !== 1) {
      if (document.activeElement !== traceButton) floating = null;
      return;
    }
    const range = selection.getRangeAt(0);
    const element =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const content = element?.closest<HTMLElement>("[data-assistant-message]");
    const messageId = content?.dataset.assistantMessage;
    const text = selection.toString();
    if (
      !content ||
      !messageId ||
      !transcript?.contains(content) ||
      !content.contains(range.endContainer) ||
      !text.trim()
    ) {
      floating = null;
      return;
    }
    const bounds = range.getBoundingClientRect();
    const viewport = transcript.getBoundingClientRect();
    if (bounds.bottom < viewport.top || bounds.top > viewport.bottom) {
      floating = null;
      return;
    }
    floating = {
      messageId,
      text,
      left: Math.max(8, Math.min(bounds.left, window.innerWidth - 120)),
      top: Math.max(8, Math.min(bounds.bottom + 4, viewport.bottom - 26, window.innerHeight - 34)),
    };
  }

  onMount(() => {
    document.addEventListener("selectionchange", readSelection);
    document.addEventListener("scroll", readSelection, true);
    window.addEventListener("resize", readSelection);
    return () => {
      requestNumber += 1;
      document.removeEventListener("selectionchange", readSelection);
      document.removeEventListener("scroll", readSelection, true);
      window.removeEventListener("resize", readSelection);
    };
  });

  $effect(() => {
    if (!active || (selected && !messages.some(message => message.id === selected?.messageId))) {
      close();
    } else if (
      match &&
      (session?.revision !== match.revision ||
        session?.conversationVersion !== match.conversationVersion)
    ) {
      match = null;
      result = null;
      feedback = "The conversation changed. Close this panel and select the text again.";
    }
  });

  function close() {
    requestNumber += 1;
    pending = null;
    selected = null;
    match = null;
    result = null;
    floating = null;
    dialog?.close();
  }

  async function open(selection: SelectionText) {
    if (disabled || !session) return;
    selected = selection;
    floating = null;
    match = null;
    result = null;
    feedback = "";
    await tick();
    dialog?.showModal();
    document.getSelection()?.removeAllRanges();
    if (selection.text.length > selectionLimit) {
      feedback = `Select ${selectionLimit} characters or fewer.`;
      return;
    }
    await request("match");
  }

  export function traceResponse(identifier: string) {
    const message = messages.find(item => item.id === identifier && item.role === "assistant");
    if (message) void open({ messageId: message.id, text: message.content });
  }

  async function request(action: "match" | "trace", memoryId?: string) {
    if (!selected || pending) return;
    const number = ++requestNumber;
    const body = new FormData();
    body.set("message_id", selected.messageId);
    body.set("selection", selected.text);
    if (action === "trace") {
      if (!match || !memoryId) return;
      body.set("memory_id", memoryId);
      body.set("revision", String(match.revision));
      body.set("conversation_version", String(match.conversationVersion));
    }
    pending = action;
    feedback = "";
    result = null;
    if (action === "match") match = null;
    try {
      let outcome;
      try {
        const response = await fetch(`?/${action}`, {
          method: "POST",
          headers: { "x-sveltekit-action": "true" },
          body,
        });
        outcome = deserialize<{ match?: MemoryMatch; trace?: MemoryTrace }, { error: string }>(
          await response.text(),
        );
      } finally {
        // Refresh before comparing revisions, even if the reservation's response was lost.
        await invalidateAll();
      }
      if (number !== requestNumber) return;
      if (outcome.type === "success" && outcome.data) {
        if (outcome.data.match) {
          match = outcome.data.match;
          result = match.trace;
        } else if (outcome.data.trace) {
          result = outcome.data.trace;
        } else {
          feedback = "The trace result could not be loaded. Close this panel and try again.";
        }
      } else {
        feedback =
          outcome.type === "failure"
            ? (outcome.data?.error ?? "The trace could not be completed.")
            : "The trace could not be completed. Close this panel and try again.";
      }
    } catch {
      if (number === requestNumber) {
        feedback =
          action === "match"
            ? "The request could not be confirmed. A matching attempt may have been used. Close this panel and refresh."
            : "The trace could not be confirmed. Close this panel and refresh.";
      }
    } finally {
      if (number === requestNumber) pending = null;
    }
  }

  async function viewSource(identifier: string) {
    close();
    await onView(identifier);
  }
</script>

{#if floating && active && !disabled}
  <button
    class="trace-action"
    style:left={floating.left + "px"}
    style:top={floating.top + "px"}
    bind:this={traceButton}
    onpointerdown={event => event.preventDefault()}
    onclick={() => floating && open(floating)}>Trace memory</button
  >
{/if}

<dialog
  class="window trace-panel"
  bind:this={dialog}
  aria-labelledby="trace-title"
  onclose={() => {
    if (!dialog?.open) close();
  }}
>
  <header class="title-bar">
    <div class="title-bar-text" id="trace-title">Trace memory</div>
    <div class="title-bar-controls">
      <button type="button" aria-label="Close" onclick={close}></button>
    </div>
  </header>
  <div class="window-body">
    {#if selected}
      <p class="selected-text">{selected.text}</p>
    {/if}
    <p role="status">
      {#if pending === "match"}
        Matching current memories...
      {:else if pending === "trace"}
        Finding the source memory version...
      {:else if session}
        {session.remainingMatchingCalls}
        {session.remainingMatchingCalls === 1 ? "match" : "matches"} remaining
      {/if}
    </p>
    {#if feedback}
      <p role="alert">{feedback}</p>
    {/if}
    {#if match && !pending && !result && !feedback}
      {#if match.candidates.length === 0}
        <p>
          No matching current memory. Older memory, conversation context, model knowledge, or
          reasoning may still have contributed.
        </p>
      {:else}
        <p>Choose a matching memory:</p>
        <ul class="candidates">
          {#each match.candidates as candidate (candidate.id)}
            <li>
              <button type="button" onclick={() => request("trace", candidate.id)}
                >{candidate.statement}</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
    {#if result && !feedback}
      <p>
        First saved in memory version {result.revision}.
        {#if result.availableInReply}
          Included in this reply's memory context.
        {:else}
          Not included in this reply's memory context.
        {/if}
      </p>
      <fieldset>
        <legend>Original user message</legend>
        <p class="source-text">{result.source.content}</p>
        <button type="button" onclick={() => result && viewSource(result.source.id)}
          >View in chat</button
        >
      </fieldset>
      <details>
        <summary>Trace details</summary>
        <p>
          Matched against memory version {result.matchingRevision}. Reply context: memory version
          {result.replyRevision}.
        </p>
        <p>This traces stored context, not proof of what caused the reply.</p>
        <fieldset>
          <legend>Checked memory versions</legend>
          <ol>
            {#each result.steps as step (step.revision)}
              <li>Memory version {step.revision}: {step.present ? "present" : "absent"}</li>
            {/each}
          </ol>
        </fieldset>
        <p>
          Change in memory version {result.revision}: {result.added.length} added,
          {result.removed.length} removed.
        </p>
      </details>
    {/if}
  </div>
</dialog>

<style>
  .trace-action {
    position: fixed;
    z-index: 3;
  }

  .trace-panel {
    box-sizing: border-box;
    width: min(28rem, calc(100vw - 2rem));
    max-height: min(32rem, calc(100dvh - 2rem));
    border: 0;
    overflow: hidden;
  }

  .trace-panel[open] {
    display: flex;
    flex-direction: column;
  }

  .trace-panel > .title-bar {
    flex-shrink: 0;
  }

  .trace-panel > .window-body {
    min-height: 0;
    overflow: auto;
  }

  .selected-text,
  .source-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .candidates {
    padding-left: 1.25rem;
  }

  .candidates li + li {
    margin-top: 0.375rem;
  }

  .candidates button {
    text-align: left;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
