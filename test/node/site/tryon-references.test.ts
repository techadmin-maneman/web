// The looks' reference photographs (src/config/presets.ts): the tested bytes, unchanged, wherever YouCam may fetch them,
// and the small crop the picker shows beside each, which stops above the generator's mark on the full photograph.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readJsonc } from "../../../scripts/lib/jsonc.ts";
import { PRESETS, REFERENCE_VERSION } from "../../../src/config/presets.ts";

const Manifest = z.object({
  version: z.string(),
  files: z.array(z.object({ id: z.string(), file: z.string(), bytes: z.number(), sha256: z.string() })),
});
const manifest = Manifest.parse(JSON.parse(readFileSync("data/tryon-refs-v1.json", "utf8")));

/** Where each environment serves the references: the staging build's public files, and production's placeholder. */
const HOSTED = [`site/public/refs/${REFERENCE_VERSION}`, `site/placeholder/production/refs/${REFERENCE_VERSION}`];

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("the looks' reference photographs", () => {
  it("are the manifest's, one a look, under the version the looks name", () => {
    expect(manifest.version).toBe(REFERENCE_VERSION);
    expect(PRESETS.map((preset) => [preset.id, preset.reference])).toEqual(
      manifest.files.map((file) => [file.id, file.file]),
    );
  });

  it("are hosted byte for byte as tested, wherever they are served", () => {
    for (const folder of HOSTED) {
      for (const file of manifest.files) {
        const path = `${folder}/${file.file}`;
        expect(readFileSync(path).byteLength, path).toBe(file.bytes);
        expect(sha256(path), path).toBe(file.sha256);
      }
    }
  });

  it("have each a picture for the picker", () => {
    for (const preset of PRESETS) expect(existsSync(`site/src/assets/look-${preset.id}.jpg`), preset.id).toBe(true);
  });

  it("are fetched from production's public host on staging and production, under their version", () => {
    const config = z
      .object({ env: z.record(z.string(), z.object({ vars: z.object({ TRYON_REFS_URL: z.string() }) })) })
      .parse(readJsonc("wrangler.jsonc"));
    for (const name of ["staging", "production"]) {
      expect(config.env[name]?.vars.TRYON_REFS_URL, name).toBe(`https://maneman.in/refs/${REFERENCE_VERSION}`);
    }
  });
});
