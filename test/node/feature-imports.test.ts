// Each app's features import only the shared layers: the files at the top of src/, components/, lib/,
// states/, styles/ and content/, the technician app's store/, and another feature only through its index.ts, which
// says what the feature offers. A feature that reaches into another's files is how moving one broke the next.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SHARED = new Set(["components", "lib", "states", "styles", "content", "store"]);

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Each import of one feature from another that is not that feature's index.ts. */
function reachesIn(root: string): string[] {
  const found: string[] = [];
  for (const file of filesUnder(root)) {
    const [feature, ...rest] = relative(root, file).split(/[\\/]/);
    if (feature === undefined || rest.length === 0 || SHARED.has(feature)) continue;
    for (const match of readFileSync(file, "utf8").matchAll(/from "(\.[^"]+)"/g)) {
      const target = relative(root, normalize(join(dirname(file), match[1] ?? ""))).split(/[\\/]/);
      const [other, ...inside] = target;
      if (other === undefined || other === ".." || inside.length === 0) continue;
      if (other === feature || SHARED.has(other) || inside.join("/") === "index.ts") continue;
      found.push(`${relative(root, file).replace(/\\/g, "/")} -> ${target.join("/")}`);
    }
  }
  return found;
}

describe.each(["apps/app/src", "apps/ops/src", "apps/tech/src"])("%s", (root) => {
  it("lets a feature import another only through its index.ts", () => {
    expect(reachesIn(root)).toEqual([]);
  });
});
