// A day down the hours (packages/ui/DayColumn.tsx): a block as many rows as its five-minute steps, one starting inside
// the block before it starting where that one ends, one wholly inside it listed in its cell, and the minute it is now.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type DayBlock, DayColumn } from "../../packages/ui/DayColumn.tsx";

const visit = (key: string, start: number, minutes: number): DayBlock => ({
  key,
  start,
  minutes,
  look: "visit",
  title: `Visit ${key}`,
  to: `/jobs/${key}`,
});

const draw = (blocks: DayBlock[], now: number | null = null) =>
  renderToStaticMarkup(
    createElement(DayColumn, {
      label: "Thursday",
      from: 8 * 60,
      to: 12 * 60,
      hour: (minute: number) => `${String(minute / 60)}h`,
      blocks,
      now,
      nowLabel: "Now",
    }),
  );

/** The rows a block's cell spans, found by its words. */
function rowsOf(markup: string, words: string): number | null {
  const cell = [...markup.matchAll(/<td[^>]*rowSpan="(\d+)"[^>]*>(.*?)<\/td>/gi)].find((match) =>
    (match[2] ?? "").includes(words),
  );
  return cell === undefined ? null : Number(cell[1]);
}

describe("a day down the hours", () => {
  it("draws a visit as many rows as its five-minute steps, and every hour's time", () => {
    const markup = draw([visit("a", 9 * 60, 90)]);
    expect(rowsOf(markup, "Visit a")).toBe(18);
    for (const hour of ["8h", "9h", "10h", "11h", "12h"]) expect(markup).toContain(`>${hour}<`);
    expect(markup).toContain('href="/jobs/a"');
  });

  it("starts a block that would start inside the one before where that one ends", () => {
    const markup = draw([visit("a", 9 * 60, 60), visit("b", 9 * 60 + 30, 60)]);
    expect(rowsOf(markup, "Visit a")).toBe(12);
    expect(rowsOf(markup, "Visit b")).toBe(6);
  });

  it("lists a block wholly inside the one before in that one's cell, so it is never undrawn", () => {
    const markup = draw([visit("a", 10 * 60, 90), visit("b", 10 * 60 + 30, 30)]);
    expect(rowsOf(markup, "Visit a")).toBe(18);
    expect(markup).toContain('href="/jobs/b"');
  });

  it("marks the minute it is now, which a screen reader hears", () => {
    expect(draw([], 9 * 60 + 15)).toContain(">Now<");
    expect(draw([visit("a", 9 * 60, 60)], 9 * 60 + 15)).toContain(">Now<");
    expect(draw([])).not.toContain(">Now<");
  });
});
