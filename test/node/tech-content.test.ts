// The technician app's own rules, held to their sources: no money, no file
// input, and the design's words for the badges and the offline banner.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { badges, today, whatStopped } from "../../apps/tech/src/content.ts";

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
    // The fourth, a consultation and fit in one visit paid for once fitted, is one no board draws (ADR 0105).
    const { at_visit: undrawn, ...drawn } = badges;
    for (const badge of Object.values(drawn)) expect(DESIGN).toContain(badge);
    expect(DESIGN).not.toContain(undrawn);
    // "No money anywhere in the technician app": a Prepaid or Credit badge only.
    expect(sources.filter((path) => readFileSync(path, "utf8").includes("@maneman/web-kit/money"))).toEqual([]);
  });
});

// Open point 92, ruled by the owner on 27 September 2026: the other technician's first name may reach the phone,
// with when the job went to them. The prompt's example: "Ops moved this job to Sandeep at 10:40".
describe("a job ops gave to another technician", () => {
  /** 11:30 am in India on 14 January 2027. */
  const NOW = new Date("2027-01-14T06:00:00.000Z");
  const givenAway = (moved: { technician: string; at: string | null } | null) =>
    whatStopped({ note: "superseded", fields: ["technician"], moved }, NOW);

  it("names them, by first name, and when", () => {
    expect(givenAway({ technician: "Sameer", at: "2027-01-14T05:10:00.000Z" })).toBe(
      "Ops moved this job to Sameer at 10:40 am.",
    );
  });

  it("names the day of a move made on another", () => {
    expect(givenAway({ technician: "Sameer", at: "2027-01-13T12:40:00.000Z" })).toBe(
      "Ops moved this job to Sameer on 13 Jan at 6:10 pm.",
    );
  });

  it("names them without a time for a job moved in FSM itself", () => {
    expect(givenAway({ technician: "Sameer", at: null })).toBe("Ops moved this job to Sameer.");
  });

  it("names nobody where the API named nobody, and says a cancelled job was cancelled", () => {
    expect(givenAway(null)).toBe("This job is someone else's now.");
    expect(whatStopped({ note: "superseded", fields: ["status", "technician"], moved: null }, NOW)).toBe(
      "This job was cancelled while the phone was offline.",
    );
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

  // The encoding is shared with the site's try-on copy (packages/web-kit/small-jpeg.ts, ADR 0084).
  it("takes its frames from getUserMedia into a canvas", () => {
    const capture = readFileSync(`${SOURCE}/camera/capture.ts`, "utf8");
    const encoder = readFileSync("packages/web-kit/small-jpeg.ts", "utf8");
    expect(capture).toContain("getUserMedia");
    // One still of the camera's frame, the photograph and its thumbnail both drawn from it.
    expect(capture).toContain("still(video,");
    expect(capture).toContain("smallJpeg(frame,");
    expect(capture).toContain("thumbnailJpeg(frame,");
    expect(encoder).toContain("toBlob");
    expect(encoder).toContain("image/jpeg");
  });

  it("re-encodes to about the 250 KB ADR 0039's R2 budget assumes", () => {
    const encoder = readFileSync("packages/web-kit/small-jpeg.ts", "utf8");
    expect(encoder).toContain("SMALL_JPEG_BYTES = 250 * 1024");
    expect(readFileSync("docs/decisions/0039-phase-2-budget.md", "utf8")).toContain("about 250 KB each");
  });
});
