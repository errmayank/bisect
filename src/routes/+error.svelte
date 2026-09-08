<script lang="ts">
  import { page } from "$app/state";
</script>

<svelte:head>
  <title>Bisect</title>
</svelte:head>

<main>
  <p>{page.error?.message}</p>
</main>
