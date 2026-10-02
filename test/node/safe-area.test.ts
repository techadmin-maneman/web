// Installed on a Face ID iPhone, the technician and client apps run to the bottom edge (viewport-fit=cover), so
// whatever sits at the foot of a screen must clear the home indicator. No browser in CI has one to measure, so
// the stylesheets are read instead.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The declarations of the rule written for exactly this selector, comments taken out. */
function ruleFor(file: string, selector: string): string {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const rule = rules.find(([, head = ""]) => head.replace(/\s+/g, " ").trim() === selector);
  if (rule === undefined) throw new Error(`${file} has no rule for ${selector}`);
  return rule[2] ?? "";
}

const BOTTOMS = [
  ["apps/tech/src/steps/steps.module.css", ".foot", "Next, Capture and Retake, and the close-out's Done"],
  ["apps/tech/src/job/job.module.css", ".foot", "I have arrived and Start job"],
  ["apps/tech/src/login/login.module.css", ".screen", "Send the code and Sign in"],
  ["apps/tech/src/components/sheet.module.css", ".sheet", "a question's two answers"],
  ["apps/tech/src/today/today.module.css", ".screen", "the last job of the day"],
  ["apps/tech/src/waiting/waiting.module.css", ".screen", "the last thing waiting to send"],
  ["apps/app/src/booking/booking.module.css", ".sheet", "Pay, Continue and Move"],
  ["apps/app/src/photos/photos.module.css", ".sheet", "Close under a photograph"],
  ["apps/app/src/refer/refer.module.css", ".sheet", "the invite's last step"],
] as const;

describe("the foot of every phone screen", () => {
  it.each(BOTTOMS)("%s %s keeps %s clear of the home indicator", (file, selector) => {
    expect(ruleFor(file, selector)).toMatch(/padding(?:-bottom)?\s*:[^;]*env\(safe-area-inset-bottom\)/);
  });
});
