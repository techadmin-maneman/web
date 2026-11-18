// The star rating (packages/ui/StarRating.tsx): five buttons named "n of 5" in a group named for what is rated, a tap
// giving that many, never an arrow key; once given and left without onRate, the stars are shown as one image, and
// nothing can be chosen.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StarRating } from "../../packages/ui/StarRating.tsx";

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

const starLabel = (stars: number) => `${String(stars)} of 5`;

describe("the star rating", () => {
  it("offers five stars to choose, each named, and says which was chosen", () => {
    const chosen: number[] = [];
    act(() => {
      root.render(
        createElement(StarRating, { label: "Rate this visit", starLabel, value: null, onRate: (n) => chosen.push(n) }),
      );
    });
    const group = page.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe("Rate this visit");
    const stars = [...page.querySelectorAll<HTMLButtonElement>("button")];
    expect(stars.map((star) => star.getAttribute("aria-label"))).toEqual([1, 2, 3, 4, 5].map(starLabel));
    act(() => {
      stars[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(chosen).toEqual([]);
    act(() => {
      stars[2]?.click();
    });
    expect(chosen).toEqual([3]);
  });

  it("shows the stars given as one image once rated, with nothing to choose", () => {
    act(() => {
      root.render(createElement(StarRating, { label: "Rate this visit", starLabel, value: 4 }));
    });
    expect(page.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("4 of 5");
    expect(page.querySelectorAll("button")).toHaveLength(0);
  });
});
