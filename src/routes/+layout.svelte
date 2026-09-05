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
  }

  :global(body) {
    margin: 0;
  }

  .application-window {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    height: 100dvh;
  }

  .title-bar {
    flex-shrink: 0;
  }

  .window-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
</style>
