// The technician app's build (docs/decisions/0026-hosts-and-surfaces.md). One
// build per environment, into dist/<environment>; scripts/build-tech.ts adds
// _headers. The service worker is a second entry, served as /sw.js so its scope
// is the whole app (apps/tech/sw/sw.ts).

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { ENVIRONMENTS, isEnvironmentName } from "../../src/config/environments.ts";
import { pwa, themeColor } from "../../packages/web-kit/pwa.ts";
import { TECH_APP } from "./pwa.ts";

const environment = process.env.MM_ENV ?? "local";
// A misnamed environment would build an app that links to production; it builds nothing instead.
if (!isEnvironmentName(environment))
  throw new Error(`MM_ENV is "${environment}", not one of ${ENVIRONMENTS.join(", ")}`);
/** The commit built, which scripts/lib/spa-build.ts passes in and the smoke tests compare with the deploy's. */
const version = process.env.MM_VERSION ?? "unversioned";

/** Names the Worker, the environment and the commit in the page, for the smoke tests (scripts/lib/smoke.ts). */
const identify: Plugin = {
  name: "mm-identify",
  transformIndexHtml: (html) =>
    html.replace(
      "</head>",
      `<meta name="mm-worker" content="mm-tech" />
<meta name="mm-environment" content="${environment}" />
<meta name="mm-version" content="${version}" />
</head>`,
    ),
};

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), identify, themeColor(), pwa(TECH_APP)],
  // packages/ui imports React too, and from there would find the repository root's React 18; this bundles the app's.
  resolve: { dedupe: ["react", "react-dom"] },
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
    // As Cloudflare routes /api/* on the technician's host to mm-api, keeping the host. MM_API_PORT moves mm-api
    // (scripts/lib/local-stack.ts).
    proxy: { "/api": { target: `http://127.0.0.1:${process.env.MM_API_PORT ?? "8787"}`, changeOrigin: false } },
  },
});
