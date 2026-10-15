import eslint from "@eslint/js";
import type { Linter } from "eslint";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
import { FRONT_PINNED } from "./eslint.front-pinned.ts";
import tseslint from "typescript-eslint";

// A suppression comment must cite the ADR that justifies it.
const ADR_DESCRIPTION = { descriptionFormat: "^: see docs/decisions/\\d{4}-[a-z0-9-]+\\.md" };

/** The most code lines a function, and a file, may hold in src/. */
const SIZE = { fn: 80, lines: 400 } as const;
/** The most code lines a test file holds before it is warned of. */
const TEST_LINES = 500;

/** A loader written inline is a new function every render, which useLoad and useAsync would run again on each one. */
const INLINE_LOADER = {
  selector: "CallExpression[callee.name=/^use(Load|LiveLoad|Async)$/] > :function",
  message: "Give useLoad or useAsync a module's function, or one held in useCallback: an inline one runs every render.",
};

/** A part of a screen loads through lazyScreen, which loads the page again when a release has removed its file. */
const BARE_LAZY = {
  selector: "ImportDeclaration[source.value='react'] > ImportSpecifier[imported.name='lazy']",
  message: "Load a part of a screen with lazyScreen (@maneman/ui/lazyScreen).",
};

/** A write runs through useOneAtATime, whose ref holds between a tap and the next render (ADR 0058). */
const HAND_BUSY = {
  selector: "CallExpression[callee.name=/^set(Busy|Working|Sending|Saving)$/][arguments.0.value=true]",
  message:
    "Run a write through useOneAtATime (@maneman/ui/useOneAtATime): a busy flag alone lets a second tap through.",
};

/** A button is drawn by the shared package: Button, TextButton, IconButton or ToggleButton keep its states. */
const RAW_BUTTON = {
  selector: "JSXOpeningElement[name.name='button']",
  message: "Draw a button with @maneman/ui: Button, TextButton, IconButton or ToggleButton.",
};

/** What the front ends may not import: the backend's own code, but for the rules it shares with them. */
const FRONT_IMPORTS = [
  {
    regex: "^(\\.\\./)+src/",
    message: "Import the backend's shared rules as @rules/config/…, @rules/policy/… or @rules/lib/….",
  },
  {
    regex: "^@rules/(?!(config|policy|lib)/)",
    message: "Only the backend's config, policy and lib are shared with the front ends.",
  },
];

/** A size rule at a level, counting code lines alone. */
const sized = (level: "error" | "warn", max: number): Linter.RuleEntry => [
  level,
  { max, skipBlankLines: true, skipComments: true },
];

/**
 * The files of src/ past SIZE today, each at the size it has: its code lines, and its longest function's. Lower a
 * figure when a file is split, and delete its line once it is within SIZE.
 */
const PINNED: Readonly<Record<string, { readonly lines?: number; readonly fn?: number }>> = {
  // A table read top to bottom, every table holding a client's rows in turn: kept whole on purpose.
  "src/policy/personal-data.ts": { lines: 508 },
};

export default defineConfig(
  {
    ignores: [
      "node_modules/",
      // Where a background agent checks the repository out; its own checks run there.
      ".claude/",
      "coverage/",
      "**/dist/",
      ".wrangler/",
      "site/.astro/",
      "site/placeholder/",
      "design/",
      "test-results/",
      "playwright-report/",
      "src/worker-configuration.d.ts",
      "site/src/lib/api-schema.ts",
      "apps/app/src/api-schema.ts",
      "apps/ops/src/api-schema.ts",
      "apps/tech/src/api-schema.ts",
      // The QR decoder, copied as published with its licence notices (docs/decisions/0162-scanning-labels.md).
      "packages/ui/qr-decoder.worker.js",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: [
          "./tsconfig.json",
          "./tsconfig.node.json",
          "./tsconfig.browser.json",
          // Before the site's, which compiles the shared parts it imports with Preact's types in React's place.
          "./packages/ui/tsconfig.json",
          "./site/tsconfig.json",
          "./site/tsconfig.worker.json",
          "./apps/app/tsconfig.json",
          "./apps/app/sw/tsconfig.json",
          "./apps/ops/tsconfig.json",
          "./apps/tech/tsconfig.json",
          "./apps/tech/sw/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": ADR_DESCRIPTION,
          "ts-expect-error": ADR_DESCRIPTION,
          "ts-nocheck": true,
          "ts-check": false,
        },
      ],
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: false }],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      // `const { omitted: _, ...rest } = object` is how a copy without one key is made.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true, argsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always"],
      "no-console": "error",
    },
  },
  {
    // src/app.ts imports every route, so a route that imported it would import all the others. The types every
    // handler needs are src/http/context.ts; only the Worker's entry and the OpenAPI documents build the app.
    files: ["src/**/*.ts"],
    ignores: ["src/index.ts", "src/openapi.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)app\\.ts$",
              message: "Import App and AppEnv from src/http/context.ts; src/app.ts is for the entry points only.",
            },
          ],
        },
      ],
    },
  },
  {
    // What a junior developer can hold in their head on a first read: no ternary inside another, and no function
    // or file past these sizes. A file past them today is pinned at its size below, so it may shrink but not grow.
    // Each table's row type is written from the migrations (npm run schema), as long as the schema is.
    files: ["src/**/*.ts"],
    ignores: ["src/lib/rows.ts"],
    rules: {
      "no-nested-ternary": "warn",
      "max-lines-per-function": sized("error", SIZE.fn),
      "max-lines": sized("error", SIZE.lines),
    },
  },
  ...Object.entries(PINNED).map(([file, pinned]) => ({
    files: [file],
    rules: {
      ...(pinned.fn === undefined ? {} : { "max-lines-per-function": sized("error", pinned.fn) }),
      ...(pinned.lines === undefined ? {} : { "max-lines": sized("error", pinned.lines) }),
    },
  })),
  {
    // The same sizes for the apps, the site and the scripts; a file past them today is held at its size
    // (eslint.front-pinned.ts). The copy tables are long by nature and left out.
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}", "site/src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    ignores: [
      "apps/*/src/content.ts",
      "apps/*/src/content/**",
      "site/src/content/**",
      "apps/*/src/api-schema.ts",
      "site/src/lib/api-schema.ts",
    ],
    rules: {
      "max-lines-per-function": sized("error", SIZE.fn),
      "max-lines": sized("error", SIZE.lines),
    },
  },
  ...Object.entries(FRONT_PINNED).map(([file, pinned]) => ({
    files: [file],
    rules: {
      ...(pinned.fn === undefined ? {} : { "max-lines-per-function": sized("error", pinned.fn) }),
      ...(pinned.lines === undefined ? {} : { "max-lines": sized("error", pinned.lines) }),
    },
  })),
  {
    files: ["scripts/**/*.ts"],
    rules: { "no-nested-ternary": "error" },
  },
  {
    // The front ends reach the backend only through its shared rules, "@rules/config/…", "@rules/policy/…" and
    // "@rules/lib/…" (scripts/build/rules-alias.ts): never by a relative path, and never into its database work,
    // routes or vendors. An app's Vite config runs in Node, before any alias, so it reaches src/ as Node does.
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}", "site/src/**/*.{ts,tsx}"],
    ignores: ["apps/*/vite.config.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: FRONT_IMPORTS }] },
  },
  {
    // A screen calls the API through its feature's module (care-api.ts, purchasing-api.ts) or api.ts's functions,
    // never through the client itself, so a call is found, and changed, in one place.
    files: ["apps/ops/src/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...FRONT_IMPORTS,
            {
              regex: "(^|/)api\\.ts$",
              importNames: ["client"],
              message: "Call the API through the feature's own module (<feature>-api.ts) or api.ts's functions.",
            },
          ],
        },
      ],
    },
  },
  {
    // A function takes four parameters at most; past that it takes one object, so a call names what it passes.
    files: ["src/**/*.ts", "apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}", "site/src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    rules: { "max-params": ["error", 4] },
  },
  {
    // A hook called conditionally breaks React at runtime, and an effect's missing dependency reads stale values, so
    // both are errors. Adding a dependency blindly can loop: read the newest value without restarting the
    // effect with useEffectEvent in the apps, or useLatest (site/src/islands/useLatest.ts) on the site.
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}", "site/src/**/*.{ts,tsx}"],
    // Its rules alone: the plugin's legacy configs do not fit flat config's types.
    plugins: { "react-hooks": { rules: reactHooks.rules } },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    // Accessibility, read in every component: axe in the browser tests sees only the states a test reaches.
    files: ["apps/**/*.tsx", "packages/**/*.tsx", "site/src/**/*.tsx"],
    ...jsxA11y.configs.recommended,
    rules: {
      ...jsxA11y.configs.recommended.rules,
      // Focus moves only into what the person has just opened, a step or a panel, as the dialog pattern asks; each
      // autoFocus says why.
      "jsx-a11y-x/no-autofocus": "off",
    },
  },
  {
    // An error's message is read in one place, src/lib/d1-errors.ts: matching its words anywhere else read every
    // UNIQUE failure as a lost window.
    files: ["src/**/*.ts"],
    ignores: ["src/lib/d1-errors.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='includes'][callee.object.property.name='message']",
          message: "Read an error's message through src/lib/d1-errors.ts.",
        },
        {
          selector: "CallExpression[callee.property.name='includes'][callee.object.callee.name='String']",
          message: "Read an error's message through src/lib/d1-errors.ts.",
        },
      ],
    },
  },
  {
    // The logger is the only place src/ may write to the console.
    files: ["src/log.ts", "scripts/**/*.ts", "site/astro.config.ts"],
    rules: { "no-console": "off" },
  },
  {
    // The site Worker has no logger: one warning line for each mm-api answer it cannot use.
    files: ["site/src/worker.ts"],
    rules: { "no-console": ["error", { allow: ["warn"] }] },
  },
  {
    // A test file past 500 lines is warned of: one that long is several, each easier to find a failure in.
    files: ["test/**/*.ts", "e2e/**/*.ts"],
    rules: { "no-console": "off", "max-lines": sized("warn", TEST_LINES) },
  },
  {
    // A cast hid a consumer's changed signature from the compiler.
    files: ["test/worker/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression[typeAnnotation.typeName.name='MessageBatch']",
          message: "Build a queue's batch with fakeBatch (test/worker/batches.ts).",
        },
      ],
    },
  },
  {
    // A screen that picks between three things says so in a function that returns early.
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}", "site/src/**/*.{ts,tsx}"],
    rules: { "no-nested-ternary": "error", "no-restricted-syntax": ["error", INLINE_LOADER, BARE_LAZY] },
  },
  {
    files: ["site/src/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", INLINE_LOADER, BARE_LAZY, RAW_BUTTON] },
  },
  {
    files: ["apps/app/src/**/*.{ts,tsx}", "apps/tech/src/**/*.{ts,tsx}", "apps/ops/src/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", INLINE_LOADER, BARE_LAZY, HAND_BUSY, RAW_BUTTON] },
  },
  {
    files: ["packages/ui/lazyScreen.ts"],
    rules: { "no-restricted-syntax": ["error", INLINE_LOADER] },
  },
);
