// The ops console's build (docs/decisions/0026-hosts-and-surfaces.md), as every front end's is built
// (scripts/build/app-vite-config.ts). There is no service worker: the console is a desk tool behind Cloudflare
// Access, and nothing about a client belongs on a laptop's disk.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { appViteConfig } from "../../scripts/build/app-vite-config.ts";

// The console's copy, one file a feature (src/content/), in one chunk: its words compress best together, and
// scattered over the shared chunks they cost the first load more than a kilobyte. Activity's, Technician pay's,
// the Partners panel's and the like, each read only by its own page or panel, which loads when opened, stay in its chunk.
const output = {
  advancedChunks: {
    groups: [
      {
        name: "content",
        test: /[\\/]src[\\/]content(?:[\\/](?!(?:activity|technician-pay|partners|partner-commission|words|care|settings|spend|targets|stock-places|stock-transit|stock-views|stock-labels|purchasing|stock-match|custom-orders|supply-plan|counts|usage|quality)\.ts$)|\.ts$)/,
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
    serviceWorker: false,
    output,
  }),
);
