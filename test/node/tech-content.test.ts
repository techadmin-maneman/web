// The technician app's own rules, held to their sources: no money, no file
// input, and the design's words for the badges and the offline banner.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { badges, today } from "../../apps/tech/src/content.ts";

const SOURCE = "apps/tech/src";
const DESIGN = readFileSync("design/phase2/Technician App.dc.html", "utf8");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name).replace(/\\/g, "/");
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const sources = files(SOURCE).filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"));

describe("the technician app's content", () => {
  it("says the design's words for the offline banner", () => {
    expect(DESIGN).toContain(today.offline.title);
    expect(DESIGN).toContain(today.offline.body);
  });

  it("says the design's words for the empty day", () => {
    expect(DESIGN).toContain(today.empty.title);
    expect(DESIGN).toContain(today.empty.label);
  });

  it("names the badges as the design does, and carries no amount", () => {
    for (const badge of Object.values(badges)) expect(DESIGN).toContain(badge);
    // "No money anywhere in the technician app": a Prepaid or Credit badge only.
    expect(sources.filter((path) => readFileSync(path, "utf8").includes("@maneman/web-kit/money"))).toEqual([]);
  });
});

describe("photographs never touch the phone's gallery", () => {
  it("has no file input anywhere, which is what could save to the camera roll", () => {
    const withFileInput = sources.filter((path) => /type=["']file["']/.test(readFileSync(path, "utf8")));
    expect(withFileInput).toEqual([]);
  });

  it("uses no `capture` attribute, which on some phones writes to the gallery", () => {
    // A JSX attribute, as against the content module's `capture` copy: `capture=` or a bare `capture />`.
    const withCapture = sources
      .filter((path) => path.endsWith(".tsx"))
      .filter((path) => /\scapture(=|\s*\/?>)/.test(readFileSync(path, "utf8")));
    expect(withCapture).toEqual([]);
  });

  it("takes its frames from getUserMedia into a canvas", () => {
    const capture = readFileSync(`${SOURCE}/camera/capture.ts`, "utf8");
    expect(capture).toContain("getUserMedia");
    expect(capture).toContain("toBlob");
    expect(capture).toContain("image/jpeg");
  });

  it("re-encodes to about the 250 KB ADR 0039's R2 budget assumes", () => {
    const capture = readFileSync(`${SOURCE}/camera/capture.ts`, "utf8");
    expect(capture).toContain("TARGET_BYTES = 250 * 1024");
    expect(readFileSync("docs/decisions/0039-phase-2-budget.md", "utf8")).toContain("about 250 KB each");
  });
});
