// What may import what in src/ (docs/architecture.md): each layer imports its own and those below it, never one above,
// and no module imports itself back through others. A new upward import fails here; one the baseline lists must still
// exist, so the baseline only shrinks.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path/posix";
import { describe, expect, it } from "vitest";

/** Lowest first. Providers and the domain are one layer: the domain calls providers through their interfaces. */
const LAYERS = [
  ["lib"],
  ["config"],
  ["policy"],
  ["domain", "providers"],
  ["http", "queues", "scheduled", "wiring"],
  ["routes"],
  ["app"],
] as const;
type Layer = (typeof LAYERS)[number][number];

/** The files at src/'s top level, by the layer each stands in. */
const ROOT_FILES: Readonly<Record<string, Layer>> = {
  "src/log.ts": "lib",
  "src/dependencies.ts": "wiring",
  "src/guard.ts": "wiring",
  "src/app.ts": "app",
  "src/index.ts": "app",
  "src/openapi.ts": "app",
};

/** Upward imports there are today, each type-only: the consent purposes are policy's, and two config files name them. */
const BASELINE = [
  "src/config/message-templates.ts -> src/policy/consents.ts",
  "src/config/notices.ts -> src/policy/consents.ts",
];

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

function layerOf(file: string): Layer {
  const root = ROOT_FILES[file];
  if (root !== undefined) return root;
  const folder = file.split("/")[1] ?? "";
  const layer = LAYERS.flat().find((name) => name === folder);
  if (layer === undefined) throw new Error(`${file} is in no layer: add its folder to LAYERS`);
  return layer;
}

const rankOf = (layer: Layer): number => LAYERS.findIndex((names) => (names as readonly string[]).includes(layer));

interface Edge {
  readonly from: string;
  readonly to: string;
  readonly typeOnly: boolean;
}

const IMPORT = /^(?:import|export)\s+(type\s+)?[^;]*?from\s+"(\.[^"]+)";/gms;

const EDGES: readonly Edge[] = filesUnder("src").flatMap((from) =>
  [...readFileSync(from, "utf8").matchAll(IMPORT)].map((match) => ({
    from,
    to: normalize(join(dirname(from), match[2] ?? "")),
    typeOnly: match[1] !== undefined,
  })),
);

const name = (edge: Edge) => `${edge.from} -> ${edge.to}`;

describe("the layers of src/", () => {
  const upward = EDGES.filter(
    (edge) => edge.to.startsWith("src/") && rankOf(layerOf(edge.to)) > rankOf(layerOf(edge.from)),
  );

  it("import their own layer and those below it, and none above", () => {
    expect(upward.map(name).filter((edge) => !BASELINE.includes(edge))).toEqual([]);
  });

  it("keep no baseline entry that has since gone, so the baseline only shrinks", () => {
    expect(BASELINE.filter((edge) => !upward.map(name).includes(edge))).toEqual([]);
  });

  it("have no module that imports itself back through others", () => {
    const graph = new Map<string, string[]>();
    for (const edge of EDGES) {
      if (edge.typeOnly || !edge.to.startsWith("src/")) continue;
      graph.set(edge.from, [...(graph.get(edge.from) ?? []), edge.to]);
    }
    const cycles: string[] = [];
    const done = new Set<string>();
    const visit = (file: string, path: readonly string[]) => {
      if (path.includes(file)) {
        cycles.push([...path.slice(path.indexOf(file)), file].join(" -> "));
        return;
      }
      if (done.has(file)) return;
      for (const next of graph.get(file) ?? []) visit(next, [...path, file]);
      done.add(file);
    };
    for (const file of graph.keys()) visit(file, []);
    expect(cycles).toEqual([]);
  });
});
