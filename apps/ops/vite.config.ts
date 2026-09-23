// The ops console's build (docs/decisions/0026-hosts-and-surfaces.md). One
// build per environment, into dist/<environment>; scripts/build-ops.ts adds
// _headers. There is no service worker: the console is a desk tool behind
// Cloudflare Access, and nothing about a client belongs on a laptop's disk.

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const environment = process.env.MM_ENV ?? "local";

/** Names the Worker and the environment in the page, as the public site does, for the smoke tests. */
const identify: Plugin = {
  name: "mm-identify",
  transformIndexHtml: (html) =>
    html.replace(
      "</head>",
      `<meta name="mm-worker" content="mm-ops" />
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
    port: 5174,
    // As Cloudflare routes /api/* on the console's host to mm-api, keeping the host.
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } },
  },
});
