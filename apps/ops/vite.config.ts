// The ops console's build (docs/decisions/0026-hosts-and-surfaces.md), as every front end's is built
// (scripts/build/app-vite-config.ts). The console is a desk tool behind Cloudflare Access, and nothing about a client
// belongs on a laptop's disk: its service worker only shows a Care person's lead push on their phone, keeping nothing
// (docs/decisions/0323-the-unanswered-lead-alert.md), with the manifest an iPhone needs to show one.

import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { appViteConfig } from "../../scripts/build/app-vite-config.ts";
import { pwa } from "../../packages/web-kit/pwa.ts";
import { OPS_APP } from "./pwa.ts";

// The copy every page loads, in one chunk: its words compress best together, and scattered over the shared chunks
// they cost the first load more than a kilobyte. Those are the files src/content.ts exports; the rest stay with the
// page that loads them.
const firstLoad = [
  ...readFileSync(`${import.meta.dirname}/src/content.ts`, "utf8").matchAll(/from "\.\/content\/([a-z-]+)\.ts"/g),
].map((match) => match[1]);
const output = {
  advancedChunks: {
    groups: [
      {
        name: "content",
        test: new RegExp(`[\\\\/]src[\\\\/]content(?:[\\\\/](?:${firstLoad.join("|")}))?\\.ts$`),
      },
    ],
  },
};

export default defineConfig(
  appViteConfig({
    react: react(),
    root: import.meta.dirname,
    worker: "mm-ops",
    port: 5174,
    serviceWorker: true,
    plugins: [pwa(OPS_APP, { precache: false })],
    output,
  }),
);
