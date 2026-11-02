// The day along the hours (packages/ui/DayTimeline.tsx): a row's name with its line and booked bar, a row that warns,
// a visit in its kind's look, leave as a band, and the step it is now marked down the day.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DayTimeline, type TimelineRow } from "../../packages/ui/DayTimeline.tsx";

const STEPS = ["540", "570", "600", "630"].map((key) => ({ key, label: key }));

const draw = (rows: TimelineRow[], now: string | null = null) =>
  renderToStaticMarkup(createElement(DayTimeline, { label: "Monday", labelledBy: "day", steps: STEPS, rows, now }));

const IMRAN: TimelineRow = {
  key: "imran",
  head: "Imran Qureshi",
  meta: "2 visits · 3 h booked",
  load: 0.5,
  cells: [
    { key: "a", span: 2, look: "busy", kind: "fit", children: "Arjun Sethi" },
    { key: "b", span: 2, look: "idle" },
  ],
};

describe("a day along the hours", () => {
  it("names a row with its line beneath, and how much of the day is booked as a bar", () => {
    const markup = draw([IMRAN]);
    expect(markup).toContain(">2 visits · 3 h booked<");
    expect(markup).toMatch(/<progress [^>]*max="100" value="50" aria-hidden="true"/);
  });

  it("dresses a visit in its kind, and a row nobody is on in the warning's tone", () => {
    const busy = draw([IMRAN]);
    const nobody = draw([
      { key: "none", head: "No technician", tone: "warning", cells: [{ key: "x", span: 4, look: "unassigned" }] },
    ]);
    const classOf = (markup: string, text: string) =>
      new RegExp(`class="([^"]+)"[^>]*>${text}`).exec(markup)?.[1] ?? "";
    expect(classOf(busy, "Arjun Sethi").split(" ").length).toBe(3);
    expect(nobody).toMatch(/<th scope="row" class="[^" ]+ [^"]+">/);
  });

  it("marks the step it is now, cutting an empty stretch there, and nothing on another day", () => {
    const today = draw([IMRAN], "600");
    expect([...today.matchAll(/<td /g)]).toHaveLength(3);
    expect(draw([IMRAN])).not.toMatch(/<td colSpan="1"/);
    const css = readFileSync("packages/ui/day-timeline.module.css", "utf8");
    expect(css).toMatch(/\.now \{\s+box-shadow: inset var\(--rule-strong\) 0 0 0 var\(--status-warning\);/);
  });
});

describe("the days a visit can be booked on", () => {
  it("say beneath each day how many starts are free, where they say it", async () => {
    const { DateStrip } = await import("../../packages/ui/DateStrip.tsx");
    const day = { date: "2026-11-03", weekday: "Tue", number: "3", label: "Tuesday 3 November", open: true };
    const strip = (note?: string) =>
      renderToStaticMarkup(
        createElement(DateStrip, { name: "day", days: [{ ...day, note }], chosen: null, onChoose: () => undefined }),
      );
    expect(strip("4 free")).toMatch(/<span class="[^"]+" aria-hidden="true">4 free<\/span>/);
    expect(strip()).not.toContain("free");
  });
});
