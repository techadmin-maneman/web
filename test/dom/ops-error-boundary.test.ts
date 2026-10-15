// A console page that throws while it draws (apps/ops/src/states/ErrorBoundary.tsx): the navigation stays, the page
// says it didn't open and offers a reload, and what was thrown is reported.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { broken, shell } from "../../apps/ops/src/content.ts";
import { Shell } from "../../apps/ops/src/components/Shell.tsx";
import { AppBoundary, PageBoundary } from "../../apps/ops/src/states/ErrorBoundary.tsx";
import { contractChecked } from "./contract-fetch.ts";

let page: HTMLDivElement;
let root: Root;
let reported: string[];

function Throws(): never {
  throw new Error("a record without its visit");
}

beforeEach(() => {
  reported = [];
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string, init?: RequestInit) => {
      if (url === "/api/client-errors" && typeof init?.body === "string") reported.push(init.body);
      return Promise.resolve(Response.json({ error: { code: "unavailable", request_id: "r-1" } }, { status: 503 }));
    }),
  );
  // React logs each error a boundary catches; the test reads the page instead.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
  vi.unstubAllGlobals();
});

describe("a console page that fails to draw", () => {
  it("keeps the navigation, says so, offers a reload and reports what was thrown", async () => {
    await act(async () => {
      root.render(
        createElement(Shell, {
          route: { page: "tasks" },
          children: createElement(PageBoundary, { children: createElement(Throws) }),
        }),
      );
      await Promise.resolve();
    });
    expect(page.querySelector(`nav[aria-label="${shell.title}"]`)).not.toBeNull();
    expect(page.querySelector('[role="alert"]')?.textContent).toBe(broken.message);
    expect([...page.querySelectorAll("button")].map((button) => button.textContent)).toContain(broken.reload);
    expect(reported.join("")).toContain("a record without its visit");
  });

  it("round the whole console, offers a reload and the way in again", async () => {
    await act(async () => {
      root.render(createElement(AppBoundary, { children: createElement(Throws) }));
      await Promise.resolve();
    });
    expect(page.querySelector('[role="alert"]')?.textContent).toBe(broken.message);
    expect(page.querySelector('a[href="/"]')?.textContent).toBe(broken.home);
  });
});
