// The Worker registry (scripts/lib/workers.ts) is the one list of what this
// repository deploys: each entry's config must name it, and both deploy
// workflows must release it, so a new Worker cannot be half-added.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readJsonc } from "../../scripts/lib/jsonc.ts";
import { WORKERS } from "../../scripts/lib/workers.ts";

const workflow = (name: string) => readFileSync(`.github/workflows/${name}`, "utf8");

describe("the Worker registry", () => {
  it.each(WORKERS)("$name's config names it, and each environment appends its own name", (worker) => {
    const config = readJsonc(worker.config) as {
      name: string;
      env: Record<string, { name: string }>;
    };
    expect(config.name).toBe(worker.name);
    expect(config.env.staging?.name).toBe(`${worker.name}-staging`);
    expect(config.env.production?.name).toBe(`${worker.name}-production`);
  });

  it.each(WORKERS)("$name is released by both deploy workflows", (worker) => {
    for (const file of ["deploy-staging.yml", "deploy-production.yml"]) {
      const text = workflow(file);
      // `ship` uploads and sends all traffic in one; mm-api's upload and its traffic are separate steps.
      const shipped = text.includes(`release.ts ship --worker ${worker.name} `);
      const uploadedAndDeployed =
        text.includes(`release.ts upload --worker ${worker.name} `) &&
        text.includes(`release.ts deploy --worker ${worker.name} `);
      expect(shipped || uploadedAndDeployed, file).toBe(true);
    }
  });

  it.each(WORKERS)("$name's production version is recorded, so a failed release can roll it back", (worker) => {
    expect(workflow("deploy-production.yml")).toContain(`release.ts current --worker ${worker.name}`);
  });
});
