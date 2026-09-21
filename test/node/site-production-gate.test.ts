// The publish gate, proven end to end: a production build of the site fails
// while notices are unapproved and the legal pages have no text.

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("the production site build", () => {
  it("is blocked by the publish gate, naming every problem", { timeout: 120_000 }, () => {
    const build = spawnSync(process.execPath, ["node_modules/astro/bin/astro.mjs", "build", "--root", "site"], {
      env: { ...process.env, MM_ENV: "production" },
      encoding: "utf8",
    });
    const output = `${build.stdout}${build.stderr}`;
    expect(build.status).not.toBe(0);
    expect(output).toContain("The production build is blocked");
    expect(output).toContain("the photo notice (photo-v1) is not approved");
    expect(output).toContain("the privacy page is not published");
  });
});
