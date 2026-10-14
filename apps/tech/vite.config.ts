// The technician app's build (docs/decisions/0026-hosts-and-surfaces.md), as every front end's is built
// (scripts/build/app-vite-config.ts), with its service worker (apps/tech/sw/sw.ts) and its manifest.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { appViteConfig } from "../../scripts/build/app-vite-config.ts";
import { pwa } from "../../packages/web-kit/pwa.ts";
import { TECH_APP } from "./pwa.ts";

export default defineConfig(
  appViteConfig({
    react: react(),
    root: import.meta.dirname,
    worker: "mm-tech",
    port: 5175,
    serviceWorker: true,
    plugins: [pwa(TECH_APP)],
  }),
);
