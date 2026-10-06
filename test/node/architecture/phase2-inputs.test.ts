// The briefs and the designs the apps are built from, pinned: the prompts are the
// brief's own words and change only as a new revision, and the apps' design
// export repeats the site's design files, which it must not quietly diverge from.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Each prompt's first line and its hash. A new revision updates both. */
const PROMPTS: Readonly<Record<string, { title: string; sha256: string }>> = {
  "phase1-backend.md": {
    title: "# Prompt for the coding agent — Mane Man Phase 1 backend, rev 4.1",
    sha256: "ebfc0f0b815bc63de71cff09f270ba6c2212eb7d5adf0505aca818fca2596e51",
  },
  "phase1-frontend.md": {
    title: "# Prompt for the coding agent — Mane Man Phase 1 front end, rev 2",
    sha256: "839ec61b11901ebed54e720ecd5ec7455d32da5328eaf0955074d8fc917f323f",
  },
  "phase2-backend.md": {
    title: "# Prompt for the coding agent — Mane Man Phase 2 backend, rev 2",
    sha256: "a71edc5241a40b9cc171bae06e8a66956cee9718c0c155a5f0410626c83b6a75",
  },
  "phase2-frontend.md": {
    title: "# Prompt for the coding agent — Mane Man Phase 2 front end, rev 2",
    sha256: "550e0b3f2bea14cf5be3c3b67ec2e164ec63efc2eb00148801a0d3bf74a05ee7",
  },
};

const DESIGNS = [
  "Client App.dc.html",
  "Ops Console.dc.html",
  "Phase 2 Prototype.dc.html",
  "Referral and Waitlist.dc.html",
  "Technician App.dc.html",
];

describe("the prompts", () => {
  it.each(Object.entries(PROMPTS))("%s is the owner's text, unedited", (file, pinned) => {
    const path = `docs/prompts/${file}`;
    expect(readFileSync(path, "utf8").split("\n")[0]).toBe(pinned.title);
    expect(sha256(path)).toBe(pinned.sha256);
  });
});

describe("the Phase 2 designs", () => {
  it("are all present", () => {
    const files = readdirSync("design/phase2");
    for (const design of DESIGNS) expect(files).toContain(design);
  });

  it("run on the same prototype runtime as the Phase 1 design", () => {
    expect(sha256("design/phase2/support.js")).toBe(sha256("design/support.js"));
  });

  it("use the Phase 1 design's own placeholder images, unchanged", () => {
    for (const image of readdirSync("design/phase2/assets")) {
      expect(sha256(`design/phase2/assets/${image}`), image).toBe(sha256(`design/assets/${image}`));
    }
  });
});
