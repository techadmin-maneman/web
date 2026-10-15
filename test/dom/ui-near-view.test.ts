// A long list's rows drawn as they scroll near (packages/ui/useNearView.ts), as the dispatch board draws technicians
// past its first sixty: nothing until the row comes near, then the row for good, and everything where the browser
// cannot say what is in view.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNearView } from "../../packages/ui/useNearView.ts";

let page: HTMLElement;
let root: Root;
/** The observers the page made, each with what it is told when its element comes into view. */
let observers: { tell: (near: boolean) => void; disconnected: boolean }[];

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  observers = [];
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
  vi.unstubAllGlobals();
});

function Row() {
  const [row, near] = useNearView<HTMLDivElement>();
  return createElement("div", { ref: row }, near ? "drawn" : "waiting");
}

const draw = () => {
  act(() => {
    root.render(createElement(Row));
  });
};

it("draws a row once it comes near, and keeps it drawn", () => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private readonly seen: { tell: (near: boolean) => void; disconnected: boolean };
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        const tell = (near: boolean) => {
          callback([{ isIntersecting: near }]);
        };
        this.seen = { tell, disconnected: false };
        observers.push(this.seen);
      }
      observe() {
        return undefined;
      }
      disconnect() {
        this.seen.disconnected = true;
      }
    },
  );
  draw();
  expect(page.textContent).toBe("waiting");
  act(() => {
    observers[0]?.tell(false);
  });
  expect(page.textContent).toBe("waiting");
  act(() => {
    observers[0]?.tell(true);
  });
  expect(page.textContent).toBe("drawn");
  expect(observers[0]?.disconnected).toBe(true);
});

it("draws every row where the browser cannot say what is in view", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  draw();
  expect(page.textContent).toBe("drawn");
});
