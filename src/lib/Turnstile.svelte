<script lang="ts">
  import { onMount } from "svelte";

  interface TurnstileApi {
    render(container: HTMLElement, options: Record<string, unknown>): string | undefined;
    remove(identifier: string): void;
  }

  let {
    siteKey,
    onToken,
    onError,
    onInteraction,
  }: {
    siteKey: string;
    onToken: (token: string) => void;
    onError: (message: string) => void;
    onInteraction: (required: boolean) => void;
  } = $props();

  let container: HTMLDivElement;

  onMount(() => {
    const turnstileWindow = window as Window & { turnstile?: TurnstileApi };
    let disposed = false;
    let verified = false;
    let widgetIdentifier: string | undefined;
    let verificationTimeout: ReturnType<typeof setTimeout> | undefined;
    let script = document.querySelector<HTMLScriptElement>("script[data-bisect-turnstile]");

    function reportError(message: string) {
      if (disposed) return;
      clearTimeout(loadTimeout);
      clearTimeout(verificationTimeout);
      onInteraction(false);
      onToken("");
      onError(message);
    }

    function waitForVerification() {
      clearTimeout(verificationTimeout);
      if (verified) return;
      verificationTimeout = setTimeout(() => {
        reportError("Verification is taking too long. Please retry verification.");
      }, 45_000);
    }

    function renderTurnstile() {
      if (disposed || widgetIdentifier !== undefined) return;
      clearTimeout(loadTimeout);
      waitForVerification();
      try {
        widgetIdentifier = turnstileWindow.turnstile?.render(container, {
          sitekey: siteKey,
          action: "session",
          appearance: "interaction-only",
          theme: "light",
          "response-field": false,
          retry: "never",
          "refresh-expired": "manual",
          "refresh-timeout": "manual",
          callback: (token: string) => {
            if (disposed) return;
            verified = true;
            clearTimeout(verificationTimeout);
            onInteraction(false);
            onError("");
            onToken(token);
          },
          "before-interactive-callback": () => {
            if (disposed) return;
            clearTimeout(verificationTimeout);
            onInteraction(true);
          },
          "after-interactive-callback": () => {
            if (disposed) return;
            onInteraction(false);
            waitForVerification();
          },
          "error-callback": () => {
            reportError("Verification failed. Please retry verification.");
          },
          "expired-callback": () => {
            reportError("Verification expired. Please retry verification.");
          },
          "timeout-callback": () => {
            reportError("Verification timed out. Please retry verification.");
          },
          "unsupported-callback": () => {
            reportError("This browser could not run verification. Try another browser.");
          },
        });
        if (!widgetIdentifier)
          reportError("Verification could not start. Please retry verification.");
      } catch {
        reportError("Verification could not start. Please retry verification.");
      }
    }

    function scriptLoaded() {
      if (disposed) return;
      // Async scripts must use the load event instead of Turnstile's ready() method.
      if (turnstileWindow.turnstile) renderTurnstile();
      else scriptFailed();
    }

    function scriptFailed() {
      if (disposed) return;
      clearTimeout(loadTimeout);
      script?.remove();
      reportError("Verification could not load. Check your connection and retry verification.");
    }

    const loadTimeout = setTimeout(scriptFailed, 15_000);
    if (turnstileWindow.turnstile) {
      renderTurnstile();
    } else {
      if (!script) {
        script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.dataset.bisectTurnstile = "";
      }
      script.addEventListener("load", scriptLoaded);
      script.addEventListener("error", scriptFailed);
      if (!script.isConnected) document.head.appendChild(script);
    }

    return () => {
      disposed = true;
      clearTimeout(loadTimeout);
      clearTimeout(verificationTimeout);
      script?.removeEventListener("load", scriptLoaded);
      script?.removeEventListener("error", scriptFailed);
      if (widgetIdentifier) turnstileWindow.turnstile?.remove(widgetIdentifier);
    };
  });
</script>

<div bind:this={container}></div>
