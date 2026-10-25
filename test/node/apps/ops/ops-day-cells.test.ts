// The board's Day view (apps/ops/src/dispatch/day-cells.ts): a technician's day as half hours, a visit spanning the
// half hours it holds, a free start its own, and the time between run together.

import { describe, expect, it } from "vitest";
import { cellsOf, minuteOfDay, stepsOf } from "../../../../apps/ops/src/dispatch/day-cells.ts";

describe("a technician's day on the board", () => {
  it("reads an instant as its minute of India's day", () => {
    expect(minuteOfDay("2026-09-22T06:00:00.000Z")).toBe(11 * 60 + 30);
  });

  it("runs from 8 am to 8 pm, wider where a visit falls outside", () => {
    expect(stepsOf([])).toHaveLength(24);
    const steps = stepsOf([{ from: 7 * 60 + 15, to: 9 * 60 }]);
    expect(steps[0]).toBe(7 * 60);
    expect(steps.at(-1)).toBe(19 * 60 + 30);
  });

  it("spans a visit over its half hours, gives a free start its own, and runs the rest together", () => {
    const steps = stepsOf([]);
    const visit = { from: 9 * 60, to: 10 * 60 + 30, name: "Rohit" };
    const start = { at: 11 * 60, time: "11:00" };
    const cells = cellsOf(steps, [visit], [start]);
    expect(cells.map((cell) => [cell.kind, cell.from, cell.span])).toEqual([
      ["idle", 8 * 60, 2],
      ["busy", 9 * 60, 3],
      ["idle", 10 * 60 + 30, 1],
      ["free", 11 * 60, 1],
      ["idle", 11 * 60 + 30, 17],
    ]);
    expect(cells.reduce((sum, cell) => sum + cell.span, 0)).toBe(steps.length);
  });

  it("draws a visit over another's time from where the first ends", () => {
    const steps = stepsOf([]);
    const cells = cellsOf(
      steps,
      [
        { from: 9 * 60, to: 10 * 60 },
        { from: 9 * 60 + 30, to: 11 * 60 },
      ],
      [],
    );
    expect(cells.filter((cell) => cell.kind === "busy").map((cell) => [cell.from, cell.span])).toEqual([
      [9 * 60, 2],
      [10 * 60, 2],
    ]);
  });
});
