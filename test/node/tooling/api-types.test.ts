// Each front end's API types are generated from the OpenAPI document of its
// surface (npm run openapi). A committed copy that differs from what the
// document generates is a front end typed against an API that is not there.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe.each([
  ["the site's", "docs/openapi.json", "site/src/lib/api-schema.ts"],
  ["the client app's", "docs/openapi-client.json", "apps/app/src/api-schema.ts"],
  ["the ops console's", "docs/openapi-ops.json", "apps/ops/src/api-schema.ts"],
  ["the technician app's", "docs/openapi-tech.json", "apps/tech/src/api-schema.ts"],
])("%s API types", (_label, document, committed) => {
  it(`are generated from ${document}, unchanged (npm run openapi)`, { timeout: 60_000 }, () => {
    const folder = mkdtempSync(join(tmpdir(), "api-schema-"));
    const out = join(folder, "api-schema.ts");
    try {
      const run = spawnSync(
        process.execPath,
        ["node_modules/openapi-typescript/bin/cli.js", document, "--output", out],
        {
          encoding: "utf8",
        },
      );
      expect(run.status).toBe(0);
      expect(readFileSync(committed, "utf8")).toBe(readFileSync(out, "utf8"));
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
