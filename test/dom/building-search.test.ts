// The building search on the client app's address form and on the console's given address: only typing asks
// Google. A building chosen from the list is not searched for again, so its list stays shut over the fields below
// and the pick costs no second request.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "../../apps/app/src/api.ts";
import { AddressForm } from "../../apps/app/src/profile/AddressForm.tsx";
import { GivenAddressForm } from "../../apps/ops/src/clients/GivenAddress.tsx";

const SUNRISE_GREENS = { place_id: "place-1", primary: "Sunrise Greens", secondary: "Sector 65, Gurugram" };
/** Longer than the search's own pause after typing. */
const WELL_PAST_THE_PAUSE = 1000;

let page: HTMLElement;
let root: Root;
let searched: string[];

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  searched = [];
  vi.stubGlobal("fetch", (_url: string, init: { body: string }) => {
    const sent = JSON.parse(init.body) as { q: string };
    searched.push(sent.q);
    return Promise.resolve(Response.json({ suggestions: [SUNRISE_GREENS] }));
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
  vi.useRealTimers();
});

function show(form: React.ReactElement) {
  act(() => {
    root.render(form);
  });
}

function searchBox(): HTMLInputElement {
  const input = page.querySelector<HTMLInputElement>('[role="combobox"]');
  if (input === null) throw new Error("No building search on the page.");
  return input;
}

const listShown = () => searchBox().getAttribute("aria-expanded") === "true";

/** As a keystroke does: React hears a change only through the input's own value setter. */
function type(text: string) {
  const input = searchBox();
  act(() => {
    Reflect.set(HTMLInputElement.prototype, "value", text, input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function wait(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function chooseFirstSuggestion() {
  const option = page.querySelector('[role="option"]');
  if (option === null) throw new Error("No suggestion to choose.");
  act(() => {
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  });
}

async function typeThenChoose() {
  type("Sun");
  type("Sunr");
  type("Sunrise");
  expect(searched).toEqual([]);

  await wait(WELL_PAST_THE_PAUSE);
  expect(searched).toEqual(["Sunrise"]);
  expect(listShown()).toBe(true);

  chooseFirstSuggestion();
  expect(searchBox().value).toBe("Sunrise Greens");
  expect(listShown()).toBe(false);

  await wait(WELL_PAST_THE_PAUSE);
}

describe("the client app's building search", () => {
  it("asks once typing pauses, and not again for the building chosen", async () => {
    show(createElement(AddressForm, { address: null, saveLabel: "Save", onSaved: () => undefined }));

    await typeThenChoose();

    expect(searched).toEqual(["Sunrise"]);
    expect(listShown()).toBe(false);
  });

  it("does not search for the building an address already has when the form opens", async () => {
    const address: Address = {
      line1: "Sunrise Greens",
      line2: null,
      locality: "Sector 65",
      city: "Gurugram",
      pincode: "122102",
      access_notes: null,
      building: "Sunrise Greens",
      flat: "1204",
      floor: null,
      tower: null,
      landmark: null,
      place_id: "place-1",
    };
    show(createElement(AddressForm, { address, saveLabel: "Save", onSaved: () => undefined }));

    await wait(WELL_PAST_THE_PAUSE);

    expect(searched).toEqual([]);
    expect(listShown()).toBe(false);
  });
});

describe("the console's building search, for an address given on the phone", () => {
  it("asks once typing pauses, and not again for the building chosen", async () => {
    show(
      createElement(GivenAddressForm, { clientId: "client-1", onSaved: () => undefined, onCancel: () => undefined }),
    );

    await typeThenChoose();

    expect(searched).toEqual(["Sunrise"]);
    expect(listShown()).toBe(false);
  });
});
