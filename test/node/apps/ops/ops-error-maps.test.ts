// Every map of refusals in the console's copy says what a dropped connection is, and has a catch-all: a code a map
// does not know falls to `unknown`, so a map without `offline` read a dropped connection as "That didn't work."

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FOLDER = "apps/ops/src/content";
const modules = await Promise.all(
  readdirSync(FOLDER)
    .filter((file) => file.endsWith(".ts"))
    .map(async (file) => [file, (await import(`../../../../${FOLDER}/${file}`)) as unknown] as const),
);

/** Each `errors` map in the copy, by its path: "tasks.board.errors". */
function errorMaps(value: unknown, path: string): [string, Record<string, unknown>][] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, each]) => {
    const at = path === "" ? key : `${path}.${key}`;
    const here: [string, Record<string, unknown>][] =
      /errors$/i.test(key) && typeof each === "object" && each !== null && !Array.isArray(each)
        ? [[at, each as Record<string, unknown>]]
        : [];
    return [...here, ...errorMaps(each, at)];
  });
}

const maps = modules.flatMap(([file, exports]) => errorMaps(exports, file.replace(/\.ts$/, "")));

describe("the console's refusals", () => {
  it("are found", () => {
    expect(maps.length).toBeGreaterThan(60);
  });

  it("each say what a dropped connection is, and have a catch-all", () => {
    const short = maps.filter(([, map]) => typeof map.offline !== "string" || typeof map.unknown !== "string");
    expect(
      short.map(([path, map]) => `${path}: ${["offline", "unknown"].filter((key) => !(key in map)).join(", ")}`),
    ).toEqual([]);
  });
});
