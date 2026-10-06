import eslint from "@eslint/js";
import type { Linter } from "eslint";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// A suppression comment must cite the ADR that justifies it.
const ADR_DESCRIPTION = { descriptionFormat: "^: see docs/decisions/\\d{4}-[a-z0-9-]+\\.md" };

/** The most code lines a function, and a file, may hold in src/. */
const SIZE = { fn: 80, lines: 400 } as const;
/** The most code lines a test file holds before it is warned of. */
const TEST_LINES = 500;

/** A size rule at a level, counting code lines alone. */
const sized = (level: "error" | "warn", max: number): Linter.RuleEntry => [
  level,
  { max, skipBlankLines: true, skipComments: true },
];

/**
 * The files of src/ past SIZE today, each at the size it has: its code lines, and its longest function's. Lower a
 * figure when a file is split, and delete its line once it is within SIZE (the 2 Oct audit, CQ-10).
 */
const PINNED: Readonly<Record<string, { readonly lines?: number; readonly fn?: number }>> = {
  "src/queues/render.ts": { fn: 92 },
  "src/queues/messaging.ts": { fn: 84 },
  "src/domain/try-on/tryon-claims.ts": { fn: 81 },
  "src/domain/booking/public-consultation.ts": { fn: 130 },
  "src/domain/privacy/erasure-statements.ts": { fn: 93 },
  "src/domain/booking/hold-slot.ts": { fn: 113 },
  "src/domain/messages/visit-messages.ts": { lines: 486 },
  "src/routes/client/booking.ts": { fn: 90 },
  "src/policy/personal-data.ts": { lines: 444 },
  "src/domain/money/payment-links.ts": { lines: 451 },
  "src/providers/image/ailabtools.ts": { fn: 114 },
  "src/providers/zoho-http.ts": { fn: 108 },
  "src/queues/crm-sync.ts": { fn: 88 },
  "src/providers/payments/razorpay.ts": { fn: 81 },
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
          "./site/tsconfig.json",
          "./site/tsconfig.worker.json",
          "./apps/app/tsconfig.json",
          "./apps/app/sw/tsconfig.json",
          "./apps/ops/tsconfig.json",
          "./apps/tech/tsconfig.json",
          "./apps/tech/sw/tsconfig.json",
          "./packages/ui/tsconfig.json",
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
    files: ["src/**/*.ts"],
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
    // The same sizes for the apps, the site and the scripts, as warnings while they are brought within them. The
    // copy tables are long by nature and left out.
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}", "site/src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    ignores: ["apps/*/src/content.ts", "site/src/content/**", "apps/*/src/api-schema.ts", "site/src/lib/api-schema.ts"],
    rules: {
      "max-lines-per-function": sized("warn", SIZE.fn),
      "max-lines": sized("warn", SIZE.lines),
    },
  },
  {
    files: ["scripts/**/*.ts"],
    rules: { "no-nested-ternary": "error" },
  },
  {
    // A function takes four parameters at most; past that it takes one object, so a call names what it passes.
    files: ["src/**/*.ts", "apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}", "site/src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    rules: { "max-params": ["error", 4] },
  },
  {
    // A hook called conditionally breaks React at runtime, so that one is an error; an effect's missing dependency
    // is a warning to read, since adding it blindly can loop (the 2 Oct audit, CQ-13).
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}", "site/src/**/*.{ts,tsx}"],
    // Its rules alone: the plugin's legacy configs do not fit flat config's types.
    plugins: { "react-hooks": { rules: reactHooks.rules } },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
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
    rules: { "no-nested-ternary": "error" },
  },
);
