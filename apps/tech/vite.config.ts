// The technician app's build (docs/decisions/0026-hosts-and-surfaces.md). One
// build per environment, into dist/<environment>; scripts/build-tech.ts adds
// _headers. The service worker is a second entry, served as /sw.js so its scope
// is the whole app (apps/tech/sw/sw.ts).

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { serviceWorker } from "./sw-build.ts";

const environment = process.env.MM_ENV ?? "local";

/** Names the Worker and the environment in the page, as the public site does, for the smoke tests. */
const identify: Plugin = {
  name: "mm-identify",
  transformIndexHtml: (html) =>
    html.replace(
      "</head>",
      `<meta name="mm-worker" content="mm-tech" />
<meta name="mm-environment" content="${environment}" />
</head>`,
    ),
};

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), identify, serviceWorker()],
  define: { "import.meta.env.MM_ENV": JSON.stringify(environment) },
  build: {
    outDir: `dist/${environment}`,
    emptyOutDir: true,
    // No data: URLs: the content security policy allows none.
    assetsInlineLimit: 0,
    sourcemap: false,
    rolldownOptions: {
      input: { index: `${import.meta.dirname}/index.html`, sw: `${import.meta.dirname}/sw/sw.ts` },
      output: { entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js") },
    },
  },
  server: {
    port: 5175,
    // As Cloudflare routes /api/* on the technician's host to mm-api, keeping the host.
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } },
  },
});
