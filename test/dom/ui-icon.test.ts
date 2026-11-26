// An icon (packages/ui/Icon.tsx), as the apps, the console and the site's islands draw it: the set's glyphs in its
// line, and WhatsApp's mark filled within the set's margin, which drawn as a line read as a smudge.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BRAND_MARK_INSET, BRAND_MARKS, ICONS } from "../../packages/brand/icons.ts";
import { Button } from "../../packages/ui/Button.tsx";
import { Icon } from "../../packages/ui/Icon.tsx";

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

function drawn(element: ReturnType<typeof createElement>): { svg: SVGElement; path: SVGPathElement } {
  act(() => {
    root.render(element);
  });
  const svg = page.querySelector("svg");
  const path = page.querySelector("path");
  if (svg === null || path === null) throw new Error("no icon drawn");
  return { svg, path };
}

it("draws WhatsApp's mark filled, within the set's margin", () => {
  const { svg, path } = drawn(createElement(Icon, { d: BRAND_MARKS.whatsapp, size: "md" }));
  expect(svg.getAttribute("fill")).toBe("currentColor");
  expect(svg.getAttribute("stroke")).toBe("none");
  expect(path.getAttribute("transform")).toBe(BRAND_MARK_INSET);
});

it("draws the set's glyphs in its line", () => {
  const { svg, path } = drawn(createElement(Icon, { d: ICONS.tick, size: "md" }));
  expect(svg.getAttribute("fill")).toBe("none");
  expect(svg.getAttribute("stroke")).toBe("currentColor");
  expect(path.getAttribute("transform")).toBeNull();
});

it("fills the mark on a console button too, which draws its icon through Icon", () => {
  const { svg } = drawn(
    createElement(Button, { variant: "outline", size: "small", icon: BRAND_MARKS.whatsapp }, "WhatsApp"),
  );
  expect(svg.getAttribute("fill")).toBe("currentColor");
});
