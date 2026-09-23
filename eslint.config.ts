import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// A suppression comment must cite the ADR that justifies it.
const ADR_DESCRIPTION = { descriptionFormat: "^: see docs/decisions/\\d{4}-[a-z0-9-]+\\.md" };

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
          "./apps/tech/tsconfig.json",
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
    // The logger is the only place src/ may write to the console.
    files: ["src/log.ts", "scripts/**/*.ts", "site/astro.config.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["test/**/*.ts", "e2e/**/*.ts"],
    rules: { "no-console": "off" },
  },
);
