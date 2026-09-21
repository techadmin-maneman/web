# 0002. Repository layout and tooling

- Status: accepted
- Date: 2026-09-21

## Context

The prompt fixes two Workers (`mm-api`, `mm-site`), a `migrations/` directory, `providers/*.ts` adapters, zod as the single schema source, TypeScript strict, ESLint strict, Prettier, exact versions, and 85% line coverage on `src/`. It does not fix the layout, the router or the test runner.

## Decision

**Layout.** The repository root is `mm-api`: `src/`, `migrations/`, `wrangler.jsonc`. `site/` is `mm-site`, assets-only, with its own `wrangler.jsonc`; the front-end task replaces `site/placeholder/` with the Astro build. `scripts/` holds the build, check, release and smoke tools; `test/worker/` runs inside workerd, `test/node/` runs in Node.

**Router and schemas.** Hono with `@hono/zod-openapi`. Each route is declared once with zod schemas, which give request validation, response types, the generated `docs/openapi.json` and `docs/api.md`, and the contract test that fails when those files are stale.

**Versions** (all exact, lockfile committed):

- TypeScript 6.0.3. TypeScript 7 (the native port) is current, but `typescript-eslint` 8.70 supports `<6.1.0`.
- vitest 4.1.11. `@cloudflare/vitest-pool-workers` 0.22.0 requires `^4.1.0`; vitest 5 is out.
- `compatibility_date` is 2026-08-15, the date of the oldest workerd in the toolchain (the one the test pool bundles), so tests and deployments run with the same runtime semantics.
- `sharp` is overridden to 0.35.4: the test pool's nested miniflare pins 0.35.2, which carries GHSA-rgj7-g3m4-5g8c. The top-level wrangler already uses 0.35.4.
- npm 11 blocks install scripts unless approved; `allowScripts` approves exactly `esbuild` and `workerd`.
- `jiti` loads `eslint.config.ts`; ESLint's native loader is behind an `unstable_` flag.

**Scripts** run with Node 24's built-in type stripping (`node scripts/x.ts`), so `erasableSyntaxOnly` is on and imports carry `.ts` extensions. Two tsconfigs keep Worker globals out of Node code: `tsconfig.json` (Workers types) and `tsconfig.node.json` (Node types, plus Workers types because the OpenAPI generator imports route modules).

## Consequences

- Bumping TypeScript to 7 waits for `typescript-eslint`; bumping vitest to 5 waits for the test pool. Renovate groups these so they move together.
- When wrangler's bundled workerd and the test pool's converge, move `compatibility_date` forward in one change.
