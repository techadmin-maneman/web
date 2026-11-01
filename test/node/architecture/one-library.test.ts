// One library of shared parts (packages/ui): every app draws its buttons, drawers, confirm steps, refusals, states,
// tables and their words from it, and holds only its screens, its frame and its features. So no app keeps a folder of
// its own parts beside the library, and the library reaches into no app.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tracked = execFileSync("git", ["ls-files", "apps", "packages/ui"], { encoding: "utf8" }).split("\n");

describe("the one library of shared parts", () => {
  it("is the only place parts are kept: no app has a components/ or states/ folder of its own", () => {
    const ownParts = tracked.filter((file) => /^apps\/[^/]+\/src\/(components|states)\//.test(file));
    expect(ownParts).toEqual([]);
  });

  it("reaches into no app or the site, so every app can use all of it", () => {
    const reaching = tracked
      .filter((file) => file.startsWith("packages/ui/") && /\.tsx?$/.test(file))
      .flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)]
          .map((match) => match[1] ?? "")
          .filter((spec) => /(^|\/)(apps|site)\//.test(spec))
          .map((spec) => `${file}: ${spec}`),
      );
    expect(reaching).toEqual([]);
  });
});
