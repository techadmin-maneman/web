// The console's theme (apps/ops/src/lib/theme.ts): the computer's until the person chooses, the choice kept in this
// browser and set on <html>, and the computer's again where the browser will not keep it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, keptTheme } from "../../apps/ops/src/lib/theme.ts";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe("the console's theme", () => {
  it("follows the computer until the person chooses", () => {
    expect(keptTheme()).toBe("system");
  });

  it("is the one kept in this browser", () => {
    localStorage.setItem("mm-ops-theme", "dark");
    expect(keptTheme()).toBe("dark");
  });

  it("follows the computer for a value it does not know", () => {
    localStorage.setItem("mm-ops-theme", "sepia");
    expect(keptTheme()).toBe("system");
  });

  it("follows the computer where the browser refuses its storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("refused");
    });
    expect(keptTheme()).toBe("system");
  });

  it("sets the theme on <html>, and takes it off for the computer's", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
