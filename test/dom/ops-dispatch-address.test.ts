// The dispatch board's place in the address (apps/ops/src/dispatch/address.ts): a link opens the board on a week and
// a visit, with the visit's drawer open, and the address keeps the week, the city, the search and the open visit as
// ops change them. Links from Tasks landed on this week's bare board, and Back from a client reset it.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DispatchScreen } from "../../apps/ops/src/dispatch/DispatchScreen.tsx";
import { BOARD } from "../../e2e/ops/fixtures/dispatch.ts";

const ROHIT = BOARD.technicians[0]?.days[0]?.blocks[0]?.appointment_id ?? "";
const IN_THE_TRAY = BOARD.unassigned[1]?.appointment_id ?? "";
const NOWHERE = "79000000-0000-4000-8000-000000000001";

let page: HTMLElement;
let root: Root;
let reads: string[];

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom draws a <dialog> but cannot open one as a modal, and lays nothing out to scroll to.
  Reflect.set(HTMLDialogElement.prototype, "showModal", function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  Reflect.set(HTMLDialogElement.prototype, "close", function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  Reflect.set(Element.prototype, "scrollIntoView", () => undefined);
  reads = [];
  vi.stubGlobal("fetch", (input: string | Request) => {
    const address = new URL(typeof input === "string" ? input : input.url, "https://ops.maneman.test");
    reads.push(`${address.pathname}${address.search}`);
    if (address.pathname === "/api/dispatch") return Promise.resolve(Response.json(BOARD));
    // Who is signed in: unknown, so every action is shown and the API refuses what it must.
    return Promise.resolve(
      Response.json({ error: { code: "unknown", message: "", request_id: "r" } }, { status: 500 }),
    );
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
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openAt(path: string) {
  window.history.replaceState(null, "", path);
  act(() => {
    root.render(createElement(DispatchScreen));
  });
  await settle();
  await settle();
}

const asked = () => Object.fromEntries(new URLSearchParams(window.location.search));
const drawer = () => page.querySelector("dialog[open]");

function press(name: string, within: ParentNode = page) {
  const found = [...within.querySelectorAll("button")].find((each) => each.textContent.trim() === name);
  if (found === undefined) throw new Error(`No button "${name}" in: ${page.textContent}`);
  act(() => {
    found.click();
  });
}

/** As a person does: React hears a change only through the control's own value setter. */
function choose(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Reflect.set(prototype, "value", value, control);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

describe("the dispatch board's place in the address", () => {
  it("opens on the week a link asks for, with the visit's drawer open", async () => {
    await openAt(`/dispatch?from=2025-09-19&visit=${ROHIT}`);

    expect(reads).toContain("/api/dispatch?from=2025-09-19");
    expect(drawer()?.querySelector("h2")?.textContent).toBe("Rohit Malhotra");
    expect(asked()).toEqual({ from: "2025-09-19", visit: ROHIT });
  });

  it("keeps the week, the city, the search and the open visit as ops change them", async () => {
    await openAt("/dispatch?from=2025-09-19");

    const city = page.querySelector<HTMLSelectElement>("#dispatch-city");
    const find = page.querySelector<HTMLInputElement>("#dispatch-find");
    if (city === null || find === null) throw new Error(`No city or search in: ${page.textContent}`);
    choose(city, "Delhi");
    choose(find, "Rohit");
    expect(asked()).toEqual({ from: "2025-09-19", city: "Delhi", find: "Rohit" });

    await settle();
    press("Next week");
    expect(asked()).toEqual({ from: "2025-09-26", city: "Delhi", find: "Rohit" });

    await settle();
    const block = page.querySelector<HTMLButtonElement>(`[data-appointment="${ROHIT}"]`);
    act(() => {
      block?.click();
    });
    expect(asked()).toMatchObject({ visit: ROHIT });
    const open = drawer();
    if (open === null) throw new Error("The drawer did not open");
    press("Close", open);
    expect(asked()).toEqual({ from: "2025-09-26", city: "Delhi", find: "Rohit" });
  });

  it("opens the drawer of a visit still in the tray, and gives it back the keyboard when it closes", async () => {
    await openAt(`/dispatch?from=2025-09-19&visit=${IN_THE_TRAY}`);

    expect(drawer()).not.toBeNull();
    press("Close", drawer() ?? page);
    await settle();
    expect(drawer()).toBeNull();
    expect(document.activeElement?.getAttribute("data-appointment")).toBe(IN_THE_TRAY);
    expect(page.querySelector("[role=alert]")).toBeNull();
  });

  it("says so when the visit a link asks for is not on the board", async () => {
    await openAt(`/dispatch?from=2025-09-19&visit=${NOWHERE}`);

    expect(drawer()).toBeNull();
    expect(page.querySelector("[role=alert]")?.textContent).toBe(
      "That visit isn't on this board.",
    );
  });
});
