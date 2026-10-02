// An open sheet's own entry in the browser's history (packages/ui/sheetHistory.ts). Back used to leave the page
// under an open sheet, and the client's note went with it (UX-09). Now Back closes the sheet and the page stays;
// the entry goes again with the sheet, so the next Back leaves the page as before. The browser's history is stood
// in for, its Back landing a moment later, as a browser's does.

import { afterEach, describe, expect, it, vi } from "vitest";

type SheetHistory = typeof import("../../packages/ui/sheetHistory.ts");
type Router = typeof import("../../packages/ui/router.tsx");

const ORIGIN = "https://app.test";

interface Entry {
  readonly state: unknown;
  readonly url: string;
}

/** One tab's window: its history's entries, the one shown, and Back, which lands a moment after it is asked. */
function standInWindow(path: string) {
  const tab = new EventTarget();
  let entries: Entry[] = [{ state: null, url: `${ORIGIN}${path}` }];
  let index = 0;
  const shown = (): Entry => entries[index] ?? { state: null, url: ORIGIN };
  const address = (url: string | undefined) => (url === undefined ? shown().url : new URL(url, shown().url).href);
  const history = {
    get state() {
      return shown().state;
    },
    pushState(state: unknown, _unused: string, url?: string) {
      entries = [...entries.slice(0, index + 1), { state, url: address(url) }];
      index += 1;
    },
    replaceState(state: unknown, _unused: string, url?: string) {
      entries[index] = { state, url: address(url) };
    },
    back() {
      setTimeout(() => {
        if (index === 0) return;
        index -= 1;
        tab.dispatchEvent(new Event("popstate"));
      }, 1);
    },
  };
  const location = {
    get href() {
      return shown().url;
    },
    get pathname() {
      return new URL(shown().url).pathname;
    },
  };
  return Object.assign(tab, {
    history,
    location,
    setTimeout,
    clearTimeout,
    /** Each entry's path, and the one shown. */
    paths: () => entries.slice(0, index + 1).map((entry) => new URL(entry.url).pathname),
  });
}

let tab: ReturnType<typeof standInWindow>;

/** Long enough for the stand-in's Back to land. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 10));

async function load(path = "/visits/1"): Promise<SheetHistory & Router> {
  vi.resetModules();
  tab = standInWindow(path);
  vi.stubGlobal("window", tab);
  vi.stubGlobal("PopStateEvent", class extends Event {});
  const router = await import("../../packages/ui/router.tsx");
  const sheets = await import("../../packages/ui/sheetHistory.ts");
  return { ...router, ...sheets };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an open sheet in the history", () => {
  it("adds one entry at the page's own address", async () => {
    const { enterSheet } = await load();
    enterSheet(() => undefined);
    expect(tab.paths()).toEqual(["/visits/1", "/visits/1"]);
  });

  it("closes on Back, and the page stays where it was", async () => {
    const { enterSheet } = await load();
    const onBack = vi.fn();
    enterSheet(onBack);
    tab.history.back();
    await settled();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(tab.paths()).toEqual(["/visits/1"]);
  });

  it("takes its entry out as it closes, so the next Back leaves the page as it did before", async () => {
    const { enterSheet } = await load();
    const onBack = vi.fn();
    const leave = enterSheet(onBack);
    leave();
    await settled();
    expect(tab.paths()).toEqual(["/visits/1"]);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("hands its entry to a sheet drawn in its place, as moving a visit hands it to the booking sheet", async () => {
    const { enterSheet } = await load();
    const leaveChange = enterSheet(() => undefined);
    leaveChange();
    const onBack = vi.fn();
    const leaveBooking = enterSheet(onBack);
    await settled();
    expect(tab.paths()).toEqual(["/visits/1", "/visits/1"]);

    tab.history.back();
    await settled();
    expect(onBack).toHaveBeenCalledTimes(1);
    leaveBooking();
    await settled();
    expect(tab.paths()).toEqual(["/visits/1"]);
  });

  it("opened while the last sheet's entry is on its way out, waits for it to go and then has its own", async () => {
    const { enterSheet } = await load();
    const leave = enterSheet(() => undefined);
    leave();
    await Promise.resolve();
    const onBack = vi.fn();
    enterSheet(onBack);
    await settled();
    expect(tab.paths()).toEqual(["/visits/1", "/visits/1"]);
    expect(onBack).not.toHaveBeenCalled();
  });
});

describe("a move to another page with a sheet", () => {
  it("takes the place of an open sheet's entry, so Back from it returns to the page under the sheet", async () => {
    const { enterSheet, go } = await load("/jobs/7");
    const onBack = vi.fn();
    const leave = enterSheet(onBack);
    go("/jobs/7/done");
    leave();
    await settled();
    expect(tab.paths()).toEqual(["/jobs/7", "/jobs/7/done"]);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("waits for the entry of a sheet just closed to go, so that going back over it cannot undo the move", async () => {
    const { enterSheet, go } = await load("/jobs/7");
    const leave = enterSheet(() => undefined);
    leave();
    // The entry is on its way out once this render is over; the move comes before the browser has taken it out.
    await Promise.resolve();
    go("/jobs/7/done");
    await settled();
    expect(tab.paths()).toEqual(["/jobs/7", "/jobs/7/done"]);
  });

  it("goes at once where no sheet's entry is on its way out", async () => {
    const { go } = await load("/");
    go("/visits");
    expect(tab.paths()).toEqual(["/", "/visits"]);
  });
});
