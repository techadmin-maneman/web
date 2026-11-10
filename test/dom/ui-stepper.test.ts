// The shared stepper (packages/ui/Stepper.tsx) and a visit's step bar (packages/ui/Progress.tsx): a count moves a step
// at a time and stops at its least and its most, each key named and the count said; the bar marks the steps before
// the one under way as done.

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StepProgress, stepStates } from "../../packages/ui/Progress.tsx";
import { Stepper, stepped } from "../../packages/ui/Stepper.tsx";

let page: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
});

function Counted({ start, max }: { start: number; max: number }) {
  const [count, setCount] = useState(start);
  return createElement(Stepper, {
    value: count,
    onChange: setCount,
    step: 2,
    max,
    lessLabel: "Two fewer tape strips",
    moreLabel: "Two more tape strips",
    said: `Tape strips, ${String(count)}`,
  });
}

const key = (label: string) => page.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const press = (label: string) => {
  act(() => {
    key(label)?.click();
  });
};

describe("the stepper", () => {
  it("moves a step at a time, and stops at nought and at its most", () => {
    act(() => {
      root.render(createElement(Counted, { start: 2, max: 5 }));
    });
    press("Two more tape strips");
    expect(page.textContent).toContain("Tape strips, 4");
    press("Two more tape strips");
    expect(page.textContent).toContain("Tape strips, 5");
    expect(key("Two more tape strips")?.disabled).toBe(true);
    press("Two fewer tape strips");
    press("Two fewer tape strips");
    press("Two fewer tape strips");
    expect(page.textContent).toContain("Tape strips, 0");
    expect(key("Two fewer tape strips")?.disabled).toBe(true);
  });

  it("says the count to a screen reader, and names each key by it", () => {
    act(() => {
      root.render(createElement(Counted, { start: 3, max: 10 }));
    });
    const said = page.querySelector('[role="status"]');
    expect(said?.textContent).toBe("Tape strips, 3");
    expect(key("Two more tape strips")?.getAttribute("aria-describedby")).toBe(said?.id);
  });

  it("keeps a step within its bounds", () => {
    expect(stepped(9, 1, { step: 2, min: 0, max: 10 })).toBe(10);
    expect(stepped(1, -1, { step: 2, min: 0, max: 10 })).toBe(0);
  });
});

describe("a visit's step bar", () => {
  it("marks the steps before the one under way done, and the rest to do", () => {
    expect(stepStates(5, 2)).toEqual(["done", "done", "current", "todo", "todo"]);
    expect(stepStates(3, 3)).toEqual(["done", "done", "done"]);
  });

  it("draws a segment per step, hidden from a screen reader", () => {
    act(() => {
      root.render(createElement(StepProgress, { steps: stepStates(4, 1) }));
    });
    const bar = page.firstElementChild;
    expect(bar?.getAttribute("aria-hidden")).toBe("true");
    expect([...(bar?.children ?? [])].map((segment) => segment.getAttribute("data-state"))).toEqual([
      "done",
      "current",
      "todo",
      "todo",
    ]);
  });
});
