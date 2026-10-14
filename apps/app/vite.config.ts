// The client app's build (docs/decisions/0043-client-app.md), as every front end's is built
// (scripts/build/app-vite-config.ts), with its service worker and its manifest.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { appViteConfig } from "../../scripts/build/app-vite-config.ts";
import { pwa } from "../../packages/web-kit/pwa.ts";
import { CLIENT_APP } from "./pwa.ts";

export default defineConfig(
  appViteConfig({
    react: react(),
    root: import.meta.dirname,
    worker: "mm-app",
    port: 5173,
    serviceWorker: true,
    plugins: [pwa(CLIENT_APP)],
  }),
);
