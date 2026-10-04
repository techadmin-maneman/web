// The technician app's own rules, held to their sources: no money, no file
// input, and the design's words for the badges and the offline banner.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { badges, changed, job, notHome, today, whatStopped } from "../../apps/tech/src/content.ts";
import { jobLabel } from "../../apps/tech/src/lib/kind.ts";
import type { HeldJob } from "../../apps/tech/src/store/jobs.ts";

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

  // FLD-59, UX-35: the label's field drew a barcode, though the owner ruled a label is typed, never scanned.
  it("draws no barcode: a piece's label is typed", () => {
    expect(sources.filter((path) => readFileSync(path, "utf8").includes("pieceId"))).toEqual([]);
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

// BK-43, FLD-38, UX-25, CP-36: the banner read "4446a6e4 · Ops moved this job to another time." once the moved job
// locked again, with no client name left on the phone and no word of where the job went.
describe("a job ops moved to another time", () => {
  /** 11:30 am in India on Thursday 14 January 2027. */
  const NOW = new Date("2027-01-14T06:00:00.000Z");
  /** 4 pm that day, the start the technician knew. */
  const FOUR_PM = "2027-01-14T10:30:00.000Z";
  const movedTo = (startsNow: string | null) =>
    whatStopped({ note: "superseded", fields: ["time"], moved: null, startsAt: FOUR_PM }, NOW, startsNow);

  const relocked: HeldJob = {
    starts_at: "2027-01-15T03:30:00.000Z",
    type: "consultation",
    one_visit: false,
    sector: "Gurgaon",
    client: null,
  };

  it("says the day and time it moved to, once the card read again carries them", () => {
    expect(movedTo("2027-01-14T12:30:00.000Z")).toBe("Ops moved this job to 6 pm today.");
    expect(movedTo("2027-01-15T03:30:00.000Z")).toBe("Ops moved this job to 9 am tomorrow.");
    expect(movedTo("2027-01-18T03:30:00.000Z")).toBe("Ops moved this job to 9 am on Mon 18 Jan.");
  });

  it("says only that it moved while the phone holds no newer start", () => {
    expect(movedTo(FOUR_PM)).toBe("Ops moved this job to another time.");
    expect(movedTo(null)).toBe("Ops moved this job to another time.");
  });

  it("is named by the time the technician knew, its kind and its area, never by its ID", () => {
    expect(changed.line(jobLabel(relocked, FOUR_PM, NOW), movedTo(relocked.starts_at))).toBe(
      "4 pm consultation · Gurgaon: Ops moved this job to 9 am tomorrow.",
    );
  });

  it("names the day of a job that is not today's, and what it can when the phone holds less", () => {
    expect(jobLabel(relocked, null, NOW)).toBe("Tomorrow 9 am consultation · Gurgaon");
    expect(jobLabel({ ...relocked, one_visit: true }, FOUR_PM, NOW)).toBe("4 pm consultation and fit · Gurgaon");
    expect(jobLabel({ ...relocked, starts_at: "2027-01-18T03:30:00.000Z" }, null, NOW)).toBe(
      "Mon 18 Jan 9 am consultation · Gurgaon",
    );
    expect(jobLabel(undefined, FOUR_PM, NOW)).toBe("4 pm");
    expect(jobLabel(undefined, null, NOW)).toBe("A job");
  });
});

// FLD-56, CP-36: on the day before, a locked card said it opened "the day before"; the API's unlocks_at says when.
describe("a locked card", () => {
  /** 11:30 am in India on Thursday 14 January 2027. */
  const NOW = new Date("2027-01-14T06:00:00.000Z");

  it("says it opens at 6 pm today, on the day before the visit", () => {
    expect(job.locked.opens("2027-01-14T12:30:00.000Z", NOW)).toBe("Opens at 6 pm today.");
  });

  it("names the day when it opens on another", () => {
    expect(job.locked.opens("2027-01-15T12:30:00.000Z", NOW)).toBe("Opens at 6 pm tomorrow.");
    expect(job.locked.opens("2027-01-17T12:30:00.000Z", NOW)).toBe("Opens at 6 pm on Sun 17 Jan.");
  });

  it("says to open the job again once the hour has passed with the screen up", () => {
    expect(job.locked.opens("2027-01-14T05:30:00.000Z", NOW)).toBe(
      "Open since 11 am today. Go back and open the job again.",
    );
  });
});

// FLD-61, CP-38: the door said "within 200 m" whatever radius ops had set.
describe("the door", () => {
  it("says the radius ops set, and no number on a card kept without one", () => {
    expect(notHome.arrived.body(350)).toBe("Tap at the door. We record the time and check you are within 350 m.");
    expect(notHome.arrived.body(null)).toBe("Tap at the door. We record the time and check you are at the address.");
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
