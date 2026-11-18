// What a deploy uploads to Sentry, and that no app ships a source map (scripts/lib/sentry-maps.ts).

import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deleteMaps, uploadArgs, uploadsFor } from "../../../scripts/lib/sentry-maps.ts";

describe("Sentry's source maps at deploy", () => {
  it("uploads mm-api's bundle by its bare name and each app's files by their path, under the release", () => {
    const uploads = uploadsFor("dist/mm-api", ["apps/app/dist/staging", "apps/ops/dist/staging"]);
    expect(uploads).toEqual([
      { dir: "dist/mm-api", urlPrefix: "~/" },
      { dir: "apps/app/dist/staging", urlPrefix: "~/" },
      { dir: "apps/ops/dist/staging", urlPrefix: "~/" },
    ]);
    expect(uploadArgs({ dir: "dist/mm-api", urlPrefix: "~/" }, "production", "79455a127e46")).toEqual([
      "sourcemaps",
      "upload",
      "--org",
      "mane-man",
      "--project",
      "mm-api-production",
      "--release",
      "79455a127e46",
      "--url-prefix",
      "~/",
      "dist/mm-api",
    ]);
    expect(uploadsFor(undefined, [])).toEqual([]);
  });

  it("deletes every map from an app's build, however deep, and leaves its scripts", () => {
    const build = mkdtempSync(join(tmpdir(), "maps-"));
    mkdirSync(join(build, "assets"));
    for (const file of ["index.html", "sw.js", "sw.js.map", "assets/index-1a.js", "assets/index-1a.js.map"]) {
      writeFileSync(join(build, file), "x");
    }
    expect(deleteMaps(build)).toBe(2);
    expect(readdirSync(build, { recursive: true, encoding: "utf8" }).sort()).toEqual([
      "assets",
      join("assets", "index-1a.js"),
      "index.html",
      "sw.js",
    ]);
  });
});
