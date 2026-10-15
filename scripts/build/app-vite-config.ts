// What each front end's Vite build shares (apps/app, apps/ops, apps/tech): one build per environment, into
// dist/<environment>, which scripts/build/build-*.ts give their _headers; the Worker, the environment and the commit
// named in the page; the app's own React; no data: URLs; and, in development, /api/* sent to mm-api as Cloudflare
// routes it. An app with a service worker builds it as a second entry, served as /sw.js so its scope is the whole app.

import type { Plugin, PluginOption, UserConfig } from "vite";
import { ENVIRONMENTS, isEnvironmentName } from "../../src/config/environments.ts";
import { themeColor } from "../../packages/web-kit/pwa.ts";
import { RULES_ALIAS } from "./rules-alias.ts";

interface AppBuild {
  /** The app's folder, its vite.config.ts's `import.meta.dirname`. */
  readonly root: string;
  /** The Worker that serves it, as the smoke tests read it from the page. */
  readonly worker: string;
  /** Its development server's port. */
  readonly port: number;
  /** Whether it has a service worker, at sw/sw.ts. */
  readonly serviceWorker: boolean;
  /** Its React plugin, which each app installs for itself. */
  readonly react: PluginOption;
  readonly plugins?: readonly PluginOption[];
  /** How its chunks are drawn, where it says. */
  readonly output?: NonNullable<NonNullable<UserConfig["build"]>["rolldownOptions"]>["output"];
}

/** The page, and the service worker beside it where the app has one; or the chunks as the app draws them. */
function entriesOf(app: AppBuild) {
  if (app.serviceWorker) {
    return {
      input: { index: `${app.root}/index.html`, sw: `${app.root}/sw/sw.ts` },
      output: {
        entryFileNames: (chunk: { name: string }) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
      },
    };
  }
  return app.output === undefined ? {} : { output: app.output };
}

export function appViteConfig(app: AppBuild): UserConfig {
  const environment = process.env.MM_ENV ?? "local";
  // A misnamed environment would build an app that links to production; it builds nothing instead.
  if (!isEnvironmentName(environment)) {
    throw new Error(`MM_ENV is "${environment}", not one of ${ENVIRONMENTS.join(", ")}`);
  }
  /** The commit built, which scripts/lib/spa-build.ts passes in and the smoke tests compare with the deploy's. */
  const version = process.env.MM_VERSION ?? "unversioned";

  /** Names the Worker, the environment and the commit in the page, for the smoke tests (scripts/lib/smoke.ts). */
  const identify: Plugin = {
    name: "mm-identify",
    transformIndexHtml: (html) =>
      html.replace(
        "</head>",
        `<meta name="mm-worker" content="${app.worker}" />
<meta name="mm-environment" content="${environment}" />
<meta name="mm-version" content="${version}" />
</head>`,
      ),
  };

  return {
    root: app.root,
    plugins: [app.react, identify, themeColor(), ...(app.plugins ?? [])],
    // packages/ui imports React too, as a peer: one copy of it in each bundle, the app's.
    resolve: { dedupe: ["react", "react-dom"], alias: RULES_ALIAS },
    define: { "import.meta.env.MM_ENV": JSON.stringify(environment) },
    build: {
      outDir: `dist/${environment}`,
      emptyOutDir: true,
      // No data: URLs: the content security policy allows none.
      assetsInlineLimit: 0,
      sourcemap: false,
      rolldownOptions: entriesOf(app),
    },
    server: {
      port: app.port,
      // MM_API_PORT moves mm-api (scripts/lib/local-stack.ts).
      proxy: { "/api": { target: `http://127.0.0.1:${process.env.MM_API_PORT ?? "8787"}`, changeOrigin: false } },
    },
  };
}
