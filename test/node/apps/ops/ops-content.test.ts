// The ops console's own values, held to their sources: the launch panel shows
// the message the queue will actually send, and sends people to the public
// site's booking page.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { profile } from "../../../../apps/app/src/content.ts";
import { settings } from "../../../../apps/ops/src/content/settings.ts";
import * as ops from "../../../../apps/ops/src/content.ts";
import { areas, BOOKING_URL, deletions, dispatch, grievances } from "../../../../apps/ops/src/content.ts";
import { DELETION_ALERT_AFTER_MS } from "../../../../src/domain/privacy/deletion.ts";
import { renderMessage } from "../../../../src/config/message-templates.ts";
import { HOSTNAME } from "../../../../src/config/environments.ts";
import { BOOKING_WINDOWS } from "../../../../src/config/scheduling.ts";
import { MOVE_REASONS } from "../../../../src/policy/dispatch.ts";
import { VISIT_TYPES } from "../../../../src/config/visit-types.ts";

describe("the ops console’s content", () => {
  it("previews the launch alert word for word, with the first name left as a placeholder", () => {
    const url = BOOKING_URL.staging;
    expect(areas.launch.message("Bandra W", url)).toBe(
      renderMessage("launch_alert_v1", ["{first name}", "Bandra W", url]),
    );
  });

  it("sends people to the public site’s booking page, in each environment", () => {
    expect(BOOKING_URL.staging).toBe(`https://${HOSTNAME.staging}/book`);
    expect(BOOKING_URL.production).toBe(`https://${HOSTNAME.production}/book`);
  });
});

// Ops are shown how long a request has left against a time we have already
// promised the client, so the two have to be the same number
// (docs/decisions/0049-dpdp.md, docs/open-points.md, item 51).
describe("what the DPDP queues promise", () => {
  it("counts a grievance down to the answer time the client’s app names", () => {
    expect(profile.data.sent).toContain(`within ${String(grievances.queue.answerDays)} days`);
  });

  it("counts a deletion request down to a window the ops alert falls inside", () => {
    const alertAfterDays = DELETION_ALERT_AFTER_MS / 86_400_000;
    expect(deletions.queue.processDays).toBeGreaterThan(alertAfterDays);
  });
});

describe("the dispatch board’s words", () => {
  it("offers every reason the policy allows but a skill, which nothing records yet, and no other", () => {
    expect(dispatch.move.reasons.map((each) => each.reason)).toEqual(
      MOVE_REASONS.filter((reason) => reason !== "skill_needed"),
    );
  });

  it("names every kind of visit the board can draw", () => {
    for (const type of VISIT_TYPES) {
      expect(dispatch.types[type], type).toBeTruthy();
      expect(dispatch.typeNames[type], type).toBeTruthy();
    }
  });

  it("writes every window the API answers with", () => {
    for (const window of BOOKING_WINDOWS) expect(dispatch.windows[window], window).toBeTruthy();
  });
});

// Ops read "0.00 GB in R2", "Set by 5ef59a45….access" and the board's design notes.
describe("what the console shows ops", () => {
  /** Every string content.ts can put on screen: its strings, and what its functions write for sample values. */
  function shown(value: unknown, out: string[]): string[] {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") {
      const write = value as (...args: unknown[]) => unknown;
      for (const sample of ["x", 2]) {
        try {
          shown(write(...Array.from({ length: write.length }, () => sample)), out);
        } catch {
          // A function that needs a value of another kind writes nothing for this one.
        }
      }
    } else if (Array.isArray(value)) value.forEach((each) => shown(each, out));
    else if (typeof value === "object" && value !== null) Object.values(value).forEach((each) => shown(each, out));
    return out;
  }

  const strings = shown(Object.values(ops), []);

  it("reads every line of it", () => {
    expect(strings.length).toBeGreaterThan(1500);
    expect(strings).toContain("Settings · x");
  });

  it.each([
    ["the storage’s own name", /\bR2\b/],
    ["an environment variable", /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/],
    ["a path in the repository", /\b(?:src|apps|docs|packages|scripts|migrations)\/\w/],
    ["a design board’s own words", /\bthe board's\b/i],
    ["he, his or him for a person", /\b(he|his|him)\b/i],
    ["a tail saying what did not happen", /[.!?]\s+(Nothing was \w+|Not (saved|sent))\.?$/],
  ])("carries no %s", (_, pattern) => {
    expect(strings.filter((each) => pattern.test(each))).toEqual([]);
  });
});

// A map widened to every string compiles a lookup by a state the API adds, and the page shows its raw code. A map
// keyed by a list that is not the API's says a lookup may miss, so each lookup says what it shows then.
describe("the console’s label maps", () => {
  it("keep their keys, or say a lookup may miss", () => {
    const files = execFileSync("git", ["ls-files", "apps/ops/src/content"], { encoding: "utf8" })
      .split("\n")
      .filter((path) => path.endsWith(".ts"));
    const widened = files.filter((path) =>
      /as\s+Readonly<\s*Record<string,\s*string>\s*>/.test(readFileSync(path, "utf8")),
    );
    expect(widened).toEqual([]);
  });
});

// A rule's figure reads as the house writes it: "500000 rupees", "720 hours" and "1 service visits" did not.
describe("a rule's figure", () => {
  it.each([
    [500000, "rupees", "Rs. 5,00,000"],
    [720, "hours", "30 days"],
    [36, "hours", "36 hours"],
    [20, "per cent", "20%"],
    [140, "% of the straight line", "140% of the straight line"],
    [1, "service visits", "1 service visit"],
    [1000, "a day", "1,000 a day"],
  ])("writes %i %s as %s", (value, unit, written) => {
    expect(settings.rules.confirm.figure(value, unit)).toBe(written);
  });
});
