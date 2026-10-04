// When the open dispatch board reads itself again (apps/ops/src/dispatch/useBoard.ts). It asks for the board's
// version every minute, one row, and reads the board, hundreds of rows, only when the version has moved, or once in
// ten minutes for what the version does not watch. Coming back to the tab asks too, but not twice in half a minute.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_READ_MS, LOOK_GAP_MS, POLL_MS, useBoard } from "../../apps/ops/src/dispatch/useBoard.ts";

const BOARD_PATH = "/api/dispatch";
const VERSION_PATH = "/api/dispatch/version";

let page: HTMLElement;
let root: Root;
/** The path of every call the board made, in order. */
let asked: string[];
/** The version the server holds now. */
let serverVersion: number;
/** Every state the board drew, in order. */
let drawn: string[];
let visibility: DocumentVisibilityState;

const EMPTY_BOARD = {
  from: "2026-09-21",
  dates: [],
  city: null,
  cities: [],
  technicians: [],
  unassigned: [],
  utilisation: [],
  leave: [],
};

function Board({ paused }: { readonly paused: boolean }) {
  const { loaded } = useBoard({ from: null, city: null }, paused);
  const state = loaded.state === "loaded" ? `version ${String(loaded.value.version)}` : loaded.state;
  drawn.push(state);
  return createElement("p", null, state);
}

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  asked = [];
  drawn = [];
  serverVersion = 7;
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.stubGlobal("fetch", (url: string) => {
    const path = new URL(url, "https://ops.maneman.test").pathname;
    asked.push(path);
    if (path === VERSION_PATH) return Promise.resolve(Response.json({ version: serverVersion }));
    if (path === BOARD_PATH) return Promise.resolve(Response.json({ ...EMPTY_BOARD, version: serverVersion }));
    throw new Error(`Nothing answers ${path}`);
  });
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function open(paused = false) {
  act(() => {
    root.render(createElement(Board, { paused }));
  });
  await settle();
  asked = [];
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

async function tabComesBack() {
  act(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await settle();
}

describe("the open dispatch board", () => {
  it("asks only for the version each minute, and reads no more while it has not moved", async () => {
    await open();

    await wait(3 * POLL_MS);

    expect(asked).toEqual([VERSION_PATH, VERSION_PATH, VERSION_PATH]);
    expect(page.textContent).toBe("version 7");
  });

  it("reads itself again, without the loading state, once the version has moved", async () => {
    await open();
    serverVersion = 8;

    await wait(POLL_MS);
    await wait(POLL_MS);

    expect(asked).toEqual([VERSION_PATH, BOARD_PATH, VERSION_PATH]);
    expect(page.textContent).toBe("version 8");
    expect(drawn.slice(drawn.indexOf("version 7"))).not.toContain("loading");
  });

  it("reads itself in full every ten minutes, though nothing it watches has changed", async () => {
    await open();

    await wait(FULL_READ_MS);

    expect(asked.filter((path) => path === BOARD_PATH)).toHaveLength(1);
    expect(asked.at(-1)).toBe(BOARD_PATH);
    expect(asked.filter((path) => path === VERSION_PATH)).toHaveLength(FULL_READ_MS / POLL_MS - 1);
  });

  it("asks when the tab comes back, though not within half a minute of its last look", async () => {
    await open();

    await tabComesBack();
    expect(asked).toEqual([]);

    await wait(LOOK_GAP_MS);
    await tabComesBack();
    await tabComesBack();
    expect(asked).toEqual([VERSION_PATH]);
  });

  it("asks nothing while the tab is hidden, or while a job is in hand", async () => {
    await open(true);
    await wait(FULL_READ_MS);
    expect(asked).toEqual([]);

    await open(false);
    visibility = "hidden";
    await wait(FULL_READ_MS);
    expect(asked).toEqual([]);
  });
});
