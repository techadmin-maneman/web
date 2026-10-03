// A busy button (packages/ui/Button.tsx) does nothing on a second tap: it neither acts again nor, as a submit
// button, sends its form again.

import { act, createElement, type SyntheticEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Button } from "../../packages/ui/Button.tsx";

let page: HTMLElement;
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

function tap(): void {
  act(() => {
    page.querySelector("button")?.click();
  });
}

/** A form with one submit button, and how many times it has been sent. */
function form(busy: boolean): { sent: () => number } {
  let sent = 0;
  const send = (event: SyntheticEvent) => {
    event.preventDefault();
    sent += 1;
  };
  act(() => {
    root.render(
      createElement(
        "form",
        { onSubmit: send },
        createElement(Button, { variant: "primary", size: "action", type: "submit", busy }, "Send"),
      ),
    );
  });
  return { sent: () => sent };
}

/** A button that counts its taps. */
function counting(busy: boolean): { taps: () => number } {
  let taps = 0;
  const onClick = () => {
    taps += 1;
  };
  act(() => {
    root.render(createElement(Button, { variant: "primary", size: "action", busy, onClick }, "Pay"));
  });
  return { taps: () => taps };
}

describe("a busy button", () => {
  it("does not send its form again", () => {
    const { sent } = form(true);
    tap();
    expect(sent()).toBe(0);
  });

  it("does not act on a second tap", () => {
    const { taps } = counting(true);
    tap();
    expect(taps()).toBe(0);
  });
});

describe("a button that is not busy", () => {
  it("sends its form", () => {
    const { sent } = form(false);
    tap();
    expect(sent()).toBe(1);
  });

  it("acts on a tap", () => {
    const { taps } = counting(false);
    tap();
    expect(taps()).toBe(1);
  });
});
