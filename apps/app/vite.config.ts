// The client app's build (docs/decisions/0043-client-app.md). One build per
// environment, into dist/<environment>; scripts/build-app.ts adds _headers.

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const environment = process.env.MM_ENV ?? "local";

/** Names the Worker and the environment in the page, as the public site does, for the smoke tests. */
const identify: Plugin = {
  name: "mm-identify",
  transformIndexHtml: (html) =>
    html.replace(
      "</head>",
      `<meta name="mm-worker" content="mm-app" />
<meta name="mm-environment" content="${environment}" />
</head>`,
    ),
};

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), identify],
  define: { "import.meta.env.MM_ENV": JSON.stringify(environment) },
  build: {
    outDir: `dist/${environment}`,
    emptyOutDir: true,
    // No data: URLs: the content security policy allows none.
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: {
    port: 5173,
    // As Cloudflare routes /api/* on the app's host to mm-api, keeping the host.
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } },
  },
});
