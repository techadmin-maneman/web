// The shared parts the technician redesign added (docs/decisions/0239-technician-light-look.md): the stepper, a
// visit's step bar and progress line, the action bar's helper line, a section's head, a problem card and a radio's
// second line, each as a screen reader and a tap meet it.

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionBar } from "../../packages/ui/ActionBar.tsx";
import { Radio } from "../../packages/ui/Field.tsx";
import { ProblemCard } from "../../packages/ui/ProblemCard.tsx";
import { ProgressLine, StepProgress, stepStates } from "../../packages/ui/Progress.tsx";
import { SectionHead } from "../../packages/ui/SectionHead.tsx";
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
    expect(key("Two more tape strips")?.getAttribute("aria-disabled")).toBe("true");
    press("Two fewer tape strips");
    press("Two fewer tape strips");
    press("Two fewer tape strips");
    expect(page.textContent).toContain("Tape strips, 0");
    expect(key("Two fewer tape strips")?.getAttribute("aria-disabled")).toBe("true");
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

const draw = (element: ReturnType<typeof createElement>) => {
  act(() => {
    root.render(element);
  });
};

describe("the action bar", () => {
  it("puts the line that says what is missing above the button, and describes the button by it", () => {
    draw(
      createElement(ActionBar, {
        helper: "2 left",
        children: (helperId: string | undefined) =>
          createElement("button", { type: "button", disabled: true, "aria-describedby": helperId }, "Next"),
      }),
    );
    const helper = page.querySelector("p");
    expect(helper?.textContent).toBe("2 left");
    expect(page.querySelector("button")?.getAttribute("aria-describedby")).toBe(helper?.id);
  });

  it("draws no line, and describes nothing, once nothing is missing", () => {
    for (const helper of [false, "", null, undefined]) {
      draw(
        createElement(ActionBar, {
          helper,
          children: (helperId: string | undefined) =>
            createElement("button", { type: "button", "aria-describedby": helperId }, "Next"),
        }),
      );
      expect(page.querySelector("p")).toBeNull();
      expect(page.querySelector("button")?.hasAttribute("aria-describedby")).toBe(false);
    }
  });
});

describe("a section's head", () => {
  it("is a heading at the level asked, with what stands at the line's end", () => {
    draw(createElement(SectionHead, { title: "Later today", level: 3, size: "list", end: "Day view", id: "later" }));
    const heading = page.querySelector("h3");
    expect(heading?.textContent).toBe("Later today");
    expect(heading?.id).toBe("later");
    expect(page.textContent).toContain("Day view");
  });
});

describe("a problem card", () => {
  it("is a button where a tap opens what is wrong", () => {
    let opened = 0;
    draw(createElement(ProblemCard, { title: "2 photos not sent", onOpen: () => (opened += 1) }, "Open Waiting."));
    act(() => {
      page.querySelector("button")?.click();
    });
    expect(opened).toBe(1);
    expect(page.querySelector('[role="alert"]')).toBeNull();
  });

  it("is said at once only when it answers what was just done", () => {
    draw(createElement(ProblemCard, { title: "Ops couldn’t accept this step" }, "Fix it and tap Next."));
    expect(page.querySelector('[role="alert"]')).toBeNull();
    draw(createElement(ProblemCard, { title: "Ops couldn’t accept this step", live: true }, "Fix it and tap Next."));
    expect(page.querySelector('[role="alert"]')?.textContent).toContain("Fix it and tap Next.");
  });
});

describe("a progress line", () => {
  it("fills to its share, kept between none and all, hidden from a screen reader", () => {
    for (const [value, shown] of [
      [0.5, 0.5],
      [-1, 0],
      [3, 1],
    ] as const) {
      draw(createElement(ProgressLine, { value }));
      expect(page.querySelector("progress")?.value).toBe(shown);
      expect(page.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

describe("a radio's second line", () => {
  it("is part of the radio's name, beneath its words", () => {
    draw(createElement(Radio, { name: "fit", label: "Yes", detail: "Ops book the fit", readOnly: true }));
    const radio = page.querySelector<HTMLInputElement>('input[type="radio"]');
    const label = page.querySelector(`label[for="${radio?.id ?? ""}"]`);
    expect(label?.textContent).toBe("YesOps book the fit");
  });
});
