// How the apps move between their pages (packages/ui/router.tsx): one link for
// all three, which changes the page in place for a plain click and leaves one
// that asks for a new tab or window to the browser. The client app's own link
// swallowed a Ctrl-click, as the console's once did.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { followsHere, Link } from "../../packages/ui/router.tsx";

const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

describe("a link within an app", () => {
  it("follows a plain click without a reload", () => {
    expect(followsHere(click)).toBe(true);
  });

  it("leaves a click that asks for a new tab, a new window or a download to the browser", () => {
    expect(followsHere({ ...click, ctrlKey: true })).toBe(false);
    expect(followsHere({ ...click, metaKey: true })).toBe(false);
    expect(followsHere({ ...click, shiftKey: true })).toBe(false);
    expect(followsHere({ ...click, altKey: true })).toBe(false);
    expect(followsHere({ ...click, button: 1 })).toBe(false);
  });

  it("is a real link, so it can be opened elsewhere at all", () => {
    const markup = renderToStaticMarkup(createElement(Link, { to: "/visits", children: "Visits" }));
    expect(markup).toBe('<a href="/visits">Visits</a>');
  });

  it("marks the page shown, as the navigation does", () => {
    const markup = renderToStaticMarkup(createElement(Link, { to: "/visits", current: true, children: "Visits" }));
    expect(markup).toContain('aria-current="page"');
  });
});
