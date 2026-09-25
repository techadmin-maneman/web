// The deploy workflows run on main and by hand, never on a pull request, so a
// mistake in them is found by a deploy. What they must keep to is pinned here;
// what they decide lives in scripts and has tests of its own
// (test/node/release.test.ts, docs/decisions/0006-deployment-pipeline.md).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKERS } from "../../scripts/lib/workers.ts";

const DEPLOYS = [
  ["deploy-staging.yml", "staging"],
  ["deploy-production.yml", "production"],
] as const;

const workflow = (file: string) => readFileSync(`.github/workflows/${file}`, "utf8");

describe.each(DEPLOYS)("%s", (file, environment) => {
  const text = workflow(file);

  it("never lets a failed command read as an empty answer", () => {
    expect(text).not.toContain("|| true");
    // `echo "x=$(cmd)"` succeeds whatever cmd does; an assignment of its own fails the step when cmd fails.
    expect(text).not.toMatch(/echo "[^"\n]*\$\(/);
  });

  it("checks the database is this environment's, and uploads mm-api, before any migration runs", () => {
    const migrate = text.indexOf("d1 migrations apply");
    const identity = text.indexOf(`mark-database.ts ${environment} --check`);
    const upload = text.indexOf(`release.ts upload --worker mm-api --env ${environment}`);
    expect(migrate).toBeGreaterThan(0);
    expect(identity).toBeGreaterThan(0);
    expect(identity).toBeLessThan(migrate);
    // A version upload fails on a binding whose bucket, queue or database is missing, and sends no traffic.
    expect(upload).toBeGreaterThan(0);
    expect(upload).toBeLessThan(migrate);
  });

  it("never builds an app with its placeholder copy let through", () => {
    expect(text).not.toContain("--allow-placeholders");
  });

  it("smokes every switched-on surface against the commit it deployed", () => {
    expect(text).toMatch(/npm run smoke -- --environment \w+ --surfaces --version-tag "\$SHA"/);
  });
});

describe("the production release", () => {
  const text = workflow("deploy-production.yml");

  it.each(WORKERS)("records what $name serves before it starts, and restores it on a failure", (worker) => {
    expect(text).toContain(`release.ts current --worker ${worker.name} --env production`);
    expect(text).toContain(`--to "${worker.name}=`);
  });

  it("restores whatever a failed deploy left serving, not only what a finished deploy step did", () => {
    expect(text).not.toMatch(/steps\.\w+\.outcome }}" == "success"/);
  });
});
