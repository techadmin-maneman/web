// The words the Words page published for this environment, laid over the site's copy as the site is built
// (docs/decisions/0127-publishing-the-words.md). The build fetches them (scripts/build/build-site.ts) into
// site/.words.json; this plugin then has each copy module, as its pages and its islands import it, set its published
// lines on its own exports (./published-words-apply.ts). The site stays static: nothing is fetched at visit time.

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import type { PublishedWords } from "./published-words-apply.ts";

/** The copy modules the Words page lists, by the name their keys carry. */
const MODULES: Readonly<Record<string, string>> = {
  "src/content/site/home.ts": "home",
  "src/content/site/pages.ts": "pages",
  "src/content/site/tryon.ts": "tryon",
  "src/content/site/contact.ts": "contact",
  "src/content/guides.ts": "guides",
  "src/content/referral.ts": "referral",
  "src/content/service.ts": "service",
};

const APPLIER = fileURLToPath(new URL("./published-words-apply.ts", import.meta.url));

/** The published words the build fetched, or none: a local build, or one before any were published. */
export function readPublishedWords(file: string): PublishedWords {
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

/** The import of the applier from a copy module, as a path relative to it. */
function applierFrom(id: string): string {
  const path = relative(dirname(id), APPLIER).replaceAll("\\", "/");
  return path.startsWith(".") ? path : `./${path}`;
}

/** The plugin that has each copy module set its published lines once its own exports are made. */
export function publishedWordsPlugin(siteRoot: string, words: PublishedWords): Plugin {
  return {
    name: "mm-published-words",
    transform(code, id) {
      const file = id.split("?")[0] ?? id;
      const module = MODULES[relative(siteRoot, file).replaceAll("\\", "/")];
      if (module === undefined) return null;
      const own = Object.fromEntries(Object.entries(words).filter(([key]) => key.startsWith(`site:${module}/`)));
      if (Object.keys(own).length === 0) return null;
      const names = [...code.matchAll(/^export const (\w+)/gm)].map((match) => match[1]);
      return [
        code,
        `import { applyWords as __applyWords } from ${JSON.stringify(applierFrom(file))};`,
        `__applyWords(${JSON.stringify(module)}, { ${names.join(", ")} }, ${JSON.stringify(own)});`,
      ].join("\n");
    },
  };
}
