// A redirect (packages/ui/router.tsx) puts the page's own address in place of the one shown, which is not another page
// opening: the console's frame leaves the focus where it is for one (apps/ops/src/components/Shell.tsx), and moves it
// to the heading for a link's move.

import { afterEach, describe, expect, it } from "vitest";
import { go, redirect, wasRedirected } from "../../packages/ui/router.tsx";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("a move between pages", () => {
  it("is a redirect when the page's own address takes the place of the one shown", () => {
    redirect("/tasks");
    expect(window.location.pathname).toBe("/tasks");
    expect(wasRedirected()).toBe(true);
  });

  it("is another page opening when a link moves", () => {
    redirect("/tasks");
    go("/clients");
    expect(window.location.pathname).toBe("/clients");
    expect(wasRedirected()).toBe(false);
  });
});
