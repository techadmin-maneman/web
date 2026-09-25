// The ops console's build (docs/decisions/0026-hosts-and-surfaces.md). One
// build per environment, into dist/<environment>; scripts/build-ops.ts adds
// _headers. There is no service worker: the console is a desk tool behind
// Cloudflare Access, and nothing about a client belongs on a laptop's disk.

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const environment = process.env.MM_ENV ?? "local";
/** The commit built, which scripts/lib/spa-build.ts passes in and the smoke tests compare with the deploy's. */
const version = process.env.MM_VERSION ?? "unversioned";

/** Names the Worker, the environment and the commit in the page, for the smoke tests (scripts/lib/smoke.ts). */
const identify: Plugin = {
  name: "mm-identify",
  transformIndexHtml: (html) =>
    html.replace(
      "</head>",
      `<meta name="mm-worker" content="mm-ops" />
<meta name="mm-environment" content="${environment}" />
<meta name="mm-version" content="${version}" />
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
