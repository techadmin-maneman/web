// The front ends' one way into the backend's shared rules: "@rules/config/…", "@rules/policy/…" and "@rules/lib/…",
// the pure modules both sides keep to. eslint.config.ts refuses any other way in from apps/, packages/ and site/. Each
// bundler's config takes this, as tsconfig.base.json's paths give it to the type-checker.

import { fileURLToPath } from "node:url";

export const RULES_ALIAS = { "@rules": fileURLToPath(new URL("../../src", import.meta.url)) };
