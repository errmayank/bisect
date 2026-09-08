<script lang="ts">
  import "98.css";

  let { children } = $props();
</script>

<div class="window application-window">
  <header class="title-bar">
    <div class="title-bar-text" role="heading" aria-level="1">Bisect</div>
  </header>
  <div class="window-body">
    {@render children()}
  </div>
</div>

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

  .window-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: clip;
  }
</style>
