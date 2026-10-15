// A part of an app's code loaded when first opened (packages/web-kit/load-or-reload.ts): a page left open across a
// release asks for a file the release removed, so it loads again on the new one, but only once a minute, so a file
// that fails for any other reason is not asked for in a loop.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadOrReload } from "../../../packages/web-kit/load-or-reload.ts";

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reload = vi.fn();
  const stored = new Map<string, string>();
  vi.stubGlobal("window", { location: { reload } });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const missing = () => Promise.reject(new TypeError("Failed to fetch dynamically imported module"));

describe("a part of the code that will not load", () => {
  it("loads the page again, once a minute at most, and still fails the load", async () => {
    vi.useFakeTimers();
    await expect(loadOrReload(missing)).rejects.toThrow("dynamically imported");
    await expect(loadOrReload(missing)).rejects.toThrow("dynamically imported");
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    await expect(loadOrReload(missing)).rejects.toThrow("dynamically imported");
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("loads the page again where storage is refused", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    await expect(loadOrReload(missing)).rejects.toThrow();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("is what it loads when it loads", async () => {
    expect(await loadOrReload(() => Promise.resolve({ part: 1 }))).toEqual({ part: 1 });
    expect(reload).not.toHaveBeenCalled();
  });
});
