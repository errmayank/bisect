<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { tick, untrack } from "svelte";
  import type { SubmitFunction } from "@sveltejs/kit";
  import Turnstile from "$lib/Turnstile.svelte";
  import Trace from "$lib/Trace.svelte";
  import type { PageProps } from "./$types";

  let { data, form }: PageProps = $props();
  let selectedTab: "chat" | "memories" = $derived(
    page.params.view === "memories" ? "memories" : "chat",
  );
  let chatTab = $state<HTMLLIElement>();
  let memoriesTab = $state<HTMLLIElement>();
  let transcript = $state<HTMLDivElement>();
  let messageInput = $state<HTMLTextAreaElement>();
  let tracePanel = $state<{ traceResponse: (identifier: string) => void }>();
  let highlightedSource = $state<string | null>(null);
  let draft = $state(untrack(() => form?.draft ?? ""));
  let feedback = $state(untrack(() => (form?.action !== "start" ? (form?.error ?? "") : "")));
  let pending = $state<"start" | "reset" | "chat" | null>(null);
  let pendingMessage = $state<{
    content: string;
    sequence: number;
    conversationVersion: number;
  } | null>(null);
  let loadingDots = $state(1);
  let pendingMessageSaved = $derived(
    pendingMessage !== null &&
      data.session?.conversationVersion === pendingMessage.conversationVersion &&
      data.messages.some(
        message =>
          message.role === "user" &&
          message.sequence === pendingMessage?.sequence &&
          message.content === pendingMessage?.content,
      ),
  );
  let verificationToken = $state("");
  let verificationError = $state(untrack(() => (form?.action === "start" ? form.error : "")));
  let verificationNeedsInteraction = $state(false);
  let verificationAttempt = $state(0);
  let verificationForm = $state<HTMLFormElement>();
  const automatedCheckMessage = "Running an automated check to help keep bots out...";
  let canSend = $derived(
    pending === null &&
      !data.loadError &&
      draft.trim().length > 0 &&
      draft.length <= data.inputCharacters &&
      (data.session?.remainingChatCalls ?? 0) > 0,
  );

  $effect(() => {
    if (pending !== "chat") return;
    loadingDots = 1;
    const interval = setInterval(() => {
      loadingDots = (loadingDots % 3) + 1;
    }, 400);
    return () => clearInterval(interval);
  });

  async function scrollToLatest() {
    await tick();
    if (transcript && selectedTab === "chat") transcript.scrollTop = transcript.scrollHeight;
  }

  $effect(() => {
    if (
      !data.session &&
      !data.loadError &&
      !pending &&
      !verificationError &&
      verificationToken &&
      verificationForm
    ) {
      verificationForm.requestSubmit();
    }
  });

  async function selectTab(tab: "chat" | "memories") {
    await goto(`/${tab}`, { keepFocus: true, noScroll: true });
    (tab === "chat" ? chatTab : memoriesTab)?.focus();
  }

  async function viewSource(identifier: string) {
    await selectTab("chat");
    await tick();
    const source = document.getElementById("message-" + identifier);
    source?.scrollIntoView({ block: "center" });
    source?.focus({ preventScroll: true });
    highlightedSource = identifier;
  }

  $effect(() => {
    if (!highlightedSource) return;
    const timeout = setTimeout(() => {
      highlightedSource = null;
    }, 2000);
    return () => clearTimeout(timeout);
  });

  function handleTabKeydown(event: KeyboardEvent) {
    let nextTab = selectedTab;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowRight":
        nextTab = selectedTab === "chat" ? "memories" : "chat";
        break;
      case "Home":
        nextTab = "chat";
        break;
      case "End":
        nextTab = "memories";
        break;
      case "Enter":
      case " ":
        break;
      default:
        return;
    }
    event.preventDefault();
    selectTab(nextTab);
  }

  function refreshVerification() {
    verificationToken = "";
    verificationError = "";
    verificationNeedsInteraction = false;
    verificationAttempt += 1;
  }

  function handleComposerKeydown(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // An IME can finish composition before keydown while still reporting keyCode 229.
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!event.repeat && canSend) event.currentTarget.form?.requestSubmit();
  }

  const submit: SubmitFunction = ({ action: actionUrl, cancel, formData }) => {
    const action = actionUrl.searchParams.has("/chat")
      ? "chat"
      : actionUrl.searchParams.has("/reset")
        ? "reset"
        : "start";

    if (
      pending ||
      (action === "chat" && !canSend) ||
      (action === "reset" && !data.session) ||
      (action === "start" && (!verificationToken || verificationError))
    ) {
      cancel();
      return;
    }

    pending = action;
    if (action !== "start") feedback = "";
    const submittedDraft = action === "chat" ? String(formData.get("message") ?? "") : "";
    if (action === "chat" && data.session) {
      pendingMessage = {
        content: submittedDraft,
        sequence: (data.messages.at(-1)?.sequence ?? 0) + 1,
        conversationVersion: data.session.conversationVersion,
      };
      draft = "";
      messageInput?.focus({ preventScroll: true });
      void scrollToLatest();
    }

    function reportError(message: string) {
      if (action === "start") verificationError = message;
      else feedback = message;
    }

    return async ({ result, update }) => {
      try {
        if (result.type === "error") {
          reportError("The request could not be confirmed. Refresh before trying again.");
        } else {
          // Applying chat results resets focus; refresh its data through invalidation instead.
          if (action === "reset") await update({ reset: false, invalidateAll: false });
          if (result.type === "success") {
            if (action === "reset") draft = "";
          } else if (result.type === "failure") {
            reportError(
              typeof result.data?.error === "string"
                ? result.data.error
                : "The request failed. Please try again.",
            );
          }
          await invalidateAll();
          if (action !== "chat" && result.type === "success" && !data.session) {
            reportError("The session could not be loaded. Refresh before trying again.");
          }
        }
      } catch {
        reportError("The conversation could not be refreshed. Refresh before trying again.");
      } finally {
        if (action === "chat") {
          if (result.type !== "success" && !pendingMessageSaved) draft = submittedDraft;
          pendingMessage = null;
        }
        if (action === "start") {
          verificationToken = "";
          verificationNeedsInteraction = false;
        }
        pending = null;
        if (action === "chat") await scrollToLatest();
      }
    };
  };
</script>

<svelte:head>
  <title>Bisect</title>
  <meta
    name="description"
    content="Chat with an assistant that remembers facts and preferences you share."
  />
</svelte:head>

<main>
  <p>Bisect remembers your messages. Select text in a reply to trace its source.</p>

  {#if feedback}
    <p role="alert">{feedback}</p>
  {/if}

  {#if data.loadError}
    <p role="alert">{data.loadError}</p>
    <a href="/" data-sveltekit-reload>Refresh conversation</a>
  {:else}
    <menu role="tablist" aria-label="Conversation views">
      <li
        id="chat-tab"
        role="tab"
        aria-controls="chat"
        aria-selected={selectedTab === "chat"}
        tabindex={selectedTab === "chat" ? 0 : -1}
        bind:this={chatTab}
        onclick={event => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          selectTab("chat");
        }}
        onkeydown={handleTabKeydown}
      >
        <a href="/chat" tabindex="-1">Chat</a>
      </li>
      <li
        id="memories-tab"
        role="tab"
        aria-controls="memories"
        aria-selected={selectedTab === "memories"}
        tabindex={selectedTab === "memories" ? 0 : -1}
        bind:this={memoriesTab}
        onclick={event => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          selectTab("memories");
        }}
        onkeydown={handleTabKeydown}
      >
        <a href="/memories" tabindex="-1">Memories ({data.memories.length})</a>
      </li>
    </menu>

    <div
      class="window"
      id="chat"
      role="tabpanel"
      aria-labelledby="chat-tab"
      hidden={selectedTab !== "chat"}
    >
      <form
        class="conversation-actions"
        method="POST"
        action="?/reset"
        use:enhance={submit}
        aria-busy={pending === "reset"}
      >
        {#if data.session}
          <span>
            {data.session.remainingChatCalls}
            {data.session.remainingChatCalls === 1 ? "message" : "messages"} remaining
          </span>
        {/if}
        <button type="submit" disabled={!data.session || pending !== null}>
          {pending === "reset" ? "Resetting..." : "Reset conversation"}
        </button>
      </form>

      <div class="window-body">
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (Allows keyboard scrolling.) -->
        <div
          class="messages sunken-panel"
          role="log"
          aria-labelledby="chat-tab"
          tabindex="0"
          bind:this={transcript}
        >
          {#if data.messages.length === 0 && !pendingMessage}
            <p class="empty-message">No messages yet.</p>
          {:else}
            {#each data.messages as message (message.id)}
              <article
                class="message"
                class:source-message={highlightedSource === message.id}
                data-role={message.role}
                id={"message-" + message.id}
                aria-label={message.role === "user" ? "You" : "Assistant"}
                tabindex="-1"
              >
                <p
                  class="message-content"
                  data-assistant-message={message.role === "assistant" ? message.id : undefined}
                >
                  {message.content}
                </p>
                {#if message.role === "assistant"}
                  <button
                    class="keyboard-trace"
                    type="button"
                    disabled={pending !== null}
                    onclick={() => tracePanel?.traceResponse(message.id)}>Trace memory</button
                  >
                {/if}
              </article>
            {/each}
          {/if}
          {#if pendingMessage && !pendingMessageSaved}
            <article class="message" data-role="user" aria-label="You">
              <p class="message-content">{pendingMessage.content}</p>
            </article>
          {/if}
          {#if pending === "chat" && !pendingMessageSaved}
            <div class="message" role="status" aria-label="Waiting for reply">
              <p class="message-content" aria-hidden="true">{".".repeat(loadingDots)}</p>
            </div>
          {/if}
        </div>

        <form
          class="composer field-border"
          method="POST"
          action="?/chat"
          use:enhance={submit}
          aria-busy={pending === "chat"}
          onpointerdown={event => {
            if (event.target instanceof HTMLElement && !event.target.closest("textarea, button")) {
              event.preventDefault();
              event.currentTarget.querySelector("textarea")?.focus();
            }
          }}
        >
          <small id="message-limit">{draft.length}/{data.inputCharacters}</small>
          <textarea
            id="message"
            name="message"
            rows="2"
            maxlength={data.inputCharacters}
            required
            bind:value={draft}
            bind:this={messageInput}
            readonly={pending === "chat" || pending === "reset"}
            onkeydown={handleComposerKeydown}
            aria-label="Message"
            aria-describedby="message-limit"></textarea>
          <div class="composer-actions">
            <span class="verification-status">
              <span role="status">
                {#if !data.session && !verificationError}
                  {#if pending === "start"}
                    Starting chat...
                  {:else if verificationToken}
                    Verification complete.
                  {:else if verificationNeedsInteraction}
                    Complete the check below to continue.
                  {:else}
                    {automatedCheckMessage}
                  {/if}
                {/if}
              </span>
            </span>
          </div>
          <button type="submit" disabled={!canSend}>
            {pending === "chat" ? "Sending..." : "SEND"}
          </button>
        </form>

        {#if !data.session}
          <form
            class="verification-form"
            class:interactive={verificationNeedsInteraction}
            method="POST"
            action="?/start"
            use:enhance={submit}
            bind:this={verificationForm}
            aria-label="Session verification"
            aria-busy={pending === "start"}
          >
            {#if verificationError}
              <p role="alert">{verificationError}</p>
              <button type="button" disabled={pending !== null} onclick={refreshVerification}>
                Retry verification
              </button>
            {:else if pending !== "start"}
              {#key verificationAttempt}
                <Turnstile
                  siteKey={data.siteKey}
                  onToken={token => (verificationToken = token)}
                  onError={message => (verificationError = message)}
                  onInteraction={required => (verificationNeedsInteraction = required)}
                />
              {/key}
            {/if}

            <input type="hidden" name="turnstile_token" value={verificationToken} />
            <noscript><p>JavaScript is required to complete verification.</p></noscript>
          </form>
        {/if}

        {#if !data.session}
          <p>Sessions expire after 24 hours.</p>
        {/if}
        {#if data.session && data.session.remainingChatCalls <= 0}
          <p>This session has used all its messages.</p>
        {/if}
      </div>
    </div>

    <div
      class="window"
      id="memories"
      role="tabpanel"
      aria-labelledby="memories-tab"
      tabindex="0"
      hidden={selectedTab !== "memories"}
    >
      <div class="window-body">
        {#if data.memories.length === 0}
          <p>No memories saved yet.</p>
        {:else}
          <ul class="tree-view">
            {#each data.memories as memory (memory.id)}
              <li class="memory-content">{memory.statement}</li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
    <Trace
      bind:this={tracePanel}
      messages={data.messages}
      {transcript}
      session={data.session}
      active={selectedTab === "chat"}
      disabled={pending !== null}
      selectionLimit={data.selectedCharacters}
      onView={viewSource}
    />
  {/if}
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  main > * {
    flex-shrink: 0;
  }

  #chat:not([hidden]) {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  #chat > .window-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  #chat > .window-body > :not(.messages) {
    flex-shrink: 0;
  }

  .conversation-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    align-self: flex-end;
    margin: 8px 8px 0;
  }

  .messages {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.375rem;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.5rem;
  }

  .empty-message {
    flex-shrink: 0;
    margin: 0;
  }

  .message {
    position: relative;
    flex-shrink: 0;
    max-width: 80%;
    min-width: 0;
  }

  .source-message {
    outline: 2px solid Highlight;
  }

  .keyboard-trace:not(:focus) {
    position: absolute;
    width: 1px;
    height: 1px;
    min-width: 0;
    min-height: 0;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .message[data-role="user"] {
    align-self: flex-end;
    text-align: right;
  }

  .message-content,
  .memory-content {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .composer {
    position: relative;
  }

  #message-limit {
    position: absolute;
    top: 0.25rem;
    right: 0.375rem;
  }

  textarea {
    display: block;
    width: 100%;
    height: 5rem;
    margin: 0;
    padding-right: 5rem;
    resize: none;
    overflow-y: auto;
    scrollbar-width: none;
    /* The surrounding field-border provides the border for the entire composer. */
    box-shadow: none;
  }

  .composer-actions {
    position: absolute;
    left: 0.125rem;
    right: 7.75rem;
    bottom: 0.125rem;
    pointer-events: none;
  }

  textarea::-webkit-scrollbar {
    display: none;
  }

  .composer > button {
    position: absolute;
    right: 0.125rem;
    bottom: 0.125rem;
  }

  .verification-status {
    display: block;
    padding: 0.25rem 0.375rem;
    overflow-wrap: anywhere;
  }

  .verification-form.interactive {
    padding-top: 0.25rem;
  }
</style>
