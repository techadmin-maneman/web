// What the console prints of a day or a person is India's day and a name, never the stored value: an instant cut to
// its first ten characters is the UTC day, a day field printed as it is reads "2026-10-29", and a recorder printed as
// it is shows a service token's 40-character ID.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

const SCREENS = filesUnder("apps/ops/src").map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("the console's screens", () => {
  it("cut no instant to its UTC day", () => {
    expect(SCREENS.filter(({ text }) => text.includes("_at.slice(0, 10)")).map(({ path }) => path)).toEqual([]);
  });

  it("print no day field as it is stored", () => {
    const raw = SCREENS.flatMap(({ path, text }) =>
      [...text.matchAll(/>\{\s*[\w.]+\.(\w+_on)\s*(?:\?\?\s*""\s*)?\}</g)].map((match) => `${path}: ${match[1] ?? ""}`),
    );
    expect(raw).toEqual([]);
  });

  it("print no recorder as it is stored", () => {
    const raw = SCREENS.flatMap(({ path, text }) =>
      [...text.matchAll(/>\{\s*[\w.]+\.(\w*_by)\s*\}</g)].map((match) => `${path}: ${match[1] ?? ""}`),
    );
    expect(raw).toEqual([]);
  });
});
