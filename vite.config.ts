import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

export default defineConfig({
  plugins: [sveltekit()],
  css: {
    postcss: {
      plugins: [
        {
          postcssPlugin: "fix-98-css-hover-query",
          AtRule: {
            media(mediaRule) {
              if (mediaRule.params === "(not(hover))") {
                mediaRule.params = "(hover: none)";
              }
            },
          },
        },
      ],
    },
  },
});
