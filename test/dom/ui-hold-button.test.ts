// A button that acts only once held (packages/ui/HoldButton.tsx): held its full time it acts once; let go sooner it
// does nothing, and the fill goes; Space and Enter hold it as a finger does.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldButton } from "../../packages/ui/HoldButton.tsx";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.useRealTimers();
});

function held(onHeld: () => void): HTMLButtonElement {
  act(() => {
    root.render(createElement(HoldButton, { onHeld, children: "SOS" }));
  });
  const button = host.querySelector("button");
  if (button === null) throw new Error("no button");
  // jsdom has no pointer capture.
  button.setPointerCapture = () => undefined;
  return button;
}

const pointer = (button: HTMLButtonElement, type: "pointerdown" | "pointerup") => {
  act(() => {
    button.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1 }));
  });
};

const key = (button: HTMLButtonElement, type: "keydown" | "keyup", name: string) => {
  act(() => {
    button.dispatchEvent(new KeyboardEvent(type, { bubbles: true, key: name }));
  });
};

describe("a button held to act", () => {
  it("acts once held its full time", () => {
    const onHeld = vi.fn();
    const button = held(onHeld);
    pointer(button, "pointerdown");
    expect(button.hasAttribute("data-holding")).toBe(true);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onHeld).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute("data-holding")).toBe(false);
  });

  it("does nothing when let go sooner, and the fill goes", () => {
    const onHeld = vi.fn();
    const button = held(onHeld);
    pointer(button, "pointerdown");
    act(() => {
      vi.advanceTimersByTime(2900);
    });
    pointer(button, "pointerup");
    expect(button.hasAttribute("data-holding")).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onHeld).not.toHaveBeenCalled();
  });

  it("is held with Space or Enter as with a finger", () => {
    const onHeld = vi.fn();
    const button = held(onHeld);
    key(button, "keydown", " ");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    key(button, "keyup", " ");
    expect(onHeld).not.toHaveBeenCalled();

    key(button, "keydown", "Enter");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onHeld).toHaveBeenCalledTimes(1);
  });
});
