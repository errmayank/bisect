<script lang="ts">
  import "98.css";

  let { children } = $props();
  let aboutDialog = $state<HTMLDialogElement>();
</script>

<div class="window application-window">
  <header class="title-bar">
    <div class="title-bar-text" role="heading" aria-level="1">Bisect</div>
    <button type="button" aria-haspopup="dialog" onclick={() => aboutDialog?.showModal()}>
      About
    </button>
  </header>
  <div class="window-body">
    {@render children()}
  </div>
</div>

<dialog class="window about-panel" bind:this={aboutDialog} aria-labelledby="about-title">
  <header class="title-bar">
    <div class="title-bar-text" id="about-title">About Bisect</div>
    <div class="title-bar-controls">
      <button type="button" aria-label="Close" onclick={() => aboutDialog?.close()}></button>
    </div>
  </header>
  <div class="window-body">
    <p>
      Inspect and trace your agent's memory. Select text in the agent's reply and click "Trace
      memory" to find a matching memory. Bisect searches saved memory snapshots to find where it
      first appeared and shows the original message.
    </p>
    <p>
      If no match is found, the trace stops. The reply may come from general model knowledge or
      reasoning, or the memory matching step may have missed a relevant memory. A trace shows the
      source of stored context; it doesn't prove why the model gave a particular answer.
    </p>
    <p>Uses Llama 3.3 70B, hosted on Cloudflare Workers AI.</p>
    <p>
      <a href="https://github.com/errmayank/bisect" target="_blank" rel="noopener noreferrer">
        github.com/errmayank/bisect
      </a>
    </p>
  </div>
  <footer class="field-row about-actions">
    <button type="button" class="default" onclick={() => aboutDialog?.close()}>OK</button>
  </footer>
</dialog>

<style>
  :global(html) {
    color-scheme: light;
    height: 100%;
    overflow: hidden;
    overscroll-behavior: none;
  }

  :global(body) {
    height: 100%;
    margin: 0;
    overflow: hidden;
    overscroll-behavior: none;
  }

  .application-window {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100dvh;
    overflow: clip;
  }

  .title-bar {
    flex-shrink: 0;
  }

  .application-window > .title-bar {
    padding-left: 8px;
  }

  .application-window > .window-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: clip;
  }

  .about-panel {
    box-sizing: border-box;
    width: min(28rem, calc(100vw - 2rem));
    max-height: min(32rem, calc(100dvh - 2rem));
    border: 0;
    overflow: hidden;
  }

  .about-panel[open] {
    display: flex;
    flex-direction: column;
  }

  .about-panel > .window-body {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: none;
  }

  .about-actions {
    justify-content: flex-end;
    flex-shrink: 0;
    margin: 0 8px 8px;
  }
</style>
