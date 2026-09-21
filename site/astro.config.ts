// The public site, built once per environment into site/dist/<environment>
// and served as static assets by the mm-site Worker (site/wrangler.jsonc).
//
//   MM_ENV=staging npx astro build --root site
//
// A production build first runs the publish gate: it stops the build while any
// published block still holds the design's placeholder material, or while any
// consent notice is unapproved (docs/frontend.md).

import { readdir, readFile, writeFile } from "node:fs/promises";
import preact from "@astrojs/preact";
import { defineConfig } from "astro/config";
import { ANALYTICS_IDS } from "./src/lib/analytics-ids.ts";
import { siteEnvironment } from "./src/lib/environment.ts";
import { assertPublishable } from "./src/lib/publish-gate.ts";
import {
  contentSecurityPolicy,
  headersFile,
  inlineCode,
  pagePath,
  robotsFile,
  sitemapFile,
} from "./src/lib/static-files.ts";

const environment = siteEnvironment(process.env.MM_ENV);
if (environment === "production") assertPublishable();

export default defineConfig({
  output: "static",
  outDir: `./dist/${environment}`,
  // /try is served from try.html, so no page URL ends in a slash.
  build: { format: "file" },
  trailingSlash: "never",
  integrations: [
    preact(),
    {
      name: "mm-environment-files",
      hooks: {
        "astro:build:done": async ({ dir }) => {
          const pages = (await readdir(dir)).filter((file) => file.endsWith(".html"));
          const inline = { scripts: [] as string[], styles: [] as string[] };
          for (const page of pages) {
            const code = inlineCode(await readFile(new URL(page, dir), "utf8"));
            inline.scripts.push(...code.scripts);
            inline.styles.push(...code.styles);
          }
          const csp = contentSecurityPolicy(inline, ANALYTICS_IDS[environment]);
          const paths = pages.map(pagePath).filter((path) => path !== null);
          await writeFile(new URL("_headers", dir), headersFile(environment, csp));
          await writeFile(new URL("robots.txt", dir), robotsFile(environment));
          await writeFile(new URL("sitemap.xml", dir), sitemapFile(paths.sort()));
        },
      },
    },
  ],
  vite: {
    define: { __MM_ENV__: JSON.stringify(environment) },
    // Every asset is a file of its own: the content security policy allows no data: URLs.
    build: { assetsInlineLimit: 0 },
    // The design export and the backend's config live outside site/.
    server: { fs: { allow: [".."] } },
  },
});
