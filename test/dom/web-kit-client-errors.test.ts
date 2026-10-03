// What goes wrong in an app's own page reaches mm-api (packages/web-kit/client-errors.ts; PLAT-43): a script error,
// a promise nobody caught and a screen an error boundary caught are each posted to /api/client-errors, once, and a
// page sends only a few.

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../packages/ui/ErrorBoundary.tsx";

interface Posted {
  readonly url: string;
  readonly init: RequestInit;
  readonly report: Record<string, unknown>;
}

let posted: Posted[];

beforeEach(() => {
  posted = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    posted.push({ url, init, report: JSON.parse(init.body as string) as Record<string, unknown> });
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  // Each test gets the module afresh, and with it a page that has sent nothing yet.
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const reporter = () => import("../../packages/web-kit/client-errors.ts");

describe("a page's errors", () => {
  // The page's listeners stay for the rest of the file, so they are put on once, here.
  it("posts a script error with where it was thrown, and a promise nobody caught, same-origin", async () => {
    const { reportUncaughtErrors } = await reporter();
    reportUncaughtErrors();
    const thrown = new TypeError("Cannot read properties of undefined");
    const where = { filename: "/assets/index.js", lineno: 1, colno: 2048 };
    window.dispatchEvent(new ErrorEvent("error", { error: thrown, message: thrown.message, ...where }));
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("The day did not load") }));

    expect(posted).toHaveLength(2);
    expect(posted[0]?.url).toBe("/api/client-errors");
    expect(posted[0]?.init).toMatchObject({ method: "POST", credentials: "same-origin", keepalive: true });
    expect(posted[0]?.report).toMatchObject({
      kind: "error",
      message: "TypeError: Cannot read properties of undefined",
      source: "/assets/index.js",
      line: 1,
      column: 2048,
      path: window.location.pathname,
    });
    expect(posted[0]?.report.stack).toContain("TypeError");
    expect(posted[1]?.report).toMatchObject({ kind: "unhandled_rejection", message: "Error: The day did not load" });
  });

  it("posts what an error boundary caught, which no listener of the page's hears", async () => {
    const { reportRenderError } = await reporter();
    const page = document.createElement("div");
    const root = createRoot(page);
    const Broken = () => {
      throw new Error("The card could not draw");
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const boundary = { fallback: "Reload", onError: reportRenderError, children: createElement(Broken) };
    act(() => {
      root.render(createElement(ErrorBoundary, boundary));
    });

    expect(page.textContent).toBe("Reload");
    expect(posted.map((each) => each.report)).toEqual([
      expect.objectContaining({ kind: "render", message: "Error: The card could not draw" }),
    ]);
    act(() => {
      root.unmount();
    });
  });

  it("sends each error once, and no more than ten from a page stuck in a loop", async () => {
    const { reportClientError } = await reporter();
    reportClientError({ kind: "error", message: "the same" });
    reportClientError({ kind: "error", message: "the same" });
    expect(posted).toHaveLength(1);

    for (let count = 0; count < 20; count += 1) reportClientError({ kind: "error", message: `loop ${String(count)}` });
    expect(posted).toHaveLength(10);
  });

  it("cuts a message and a stack to what the API takes", async () => {
    const { reportClientError } = await reporter();
    reportClientError({ kind: "error", message: "m".repeat(900), stack: "s".repeat(9000) });

    expect(posted[0]?.report.message).toHaveLength(500);
    expect(posted[0]?.report.stack).toHaveLength(4000);
  });
});
