// The client app's address form, when the API will not save the address (BK-08): a pincode we do not come to says
// so on the pincode and offers the waitlist; a move to another city while a visit is booked offers a message to ops.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "../../apps/app/src/api.ts";
import { AddressForm } from "../../apps/app/src/profile/AddressForm.tsx";

const IN_MUMBAI: Address = {
  line1: "Sea View",
  line2: null,
  locality: "Bandra West",
  city: "Mumbai",
  pincode: "400050",
  access_notes: null,
  building: null,
  flat: "G-201",
  floor: null,
  tower: null,
  landmark: null,
  place_id: null,
};

let page: HTMLElement;
let root: Root;
let saved: number;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  saved = 0;
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

/** Every save is answered with this refusal. */
function refuseWith(status: number, code: string) {
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ error: { code, request_id: "r-1" } }, { status })));
}

async function save() {
  act(() => {
    root.render(
      createElement(AddressForm, {
        address: IN_MUMBAI,
        saveLabel: "Save",
        onSaved: () => {
          saved += 1;
        },
      }),
    );
  });
  const form = page.querySelector("form");
  if (form === null) throw new Error("No address form on the page.");
  act(() => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  });
  // The answer arrives a few turns of the event loop later, and React draws it as each turn's act ends.
  for (let turn = 0; turn < 20 && page.querySelector('[role="alert"]') === null; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const link = (name: string) => [...page.querySelectorAll("a")].find((each) => each.textContent === name);

describe("an address the API will not save", () => {
  it("says we do not come to its pincode, marks the pincode, and offers the waitlist", async () => {
    refuseWith(422, "not_served");
    await save();

    expect(page.querySelector('[role="alert"]')?.textContent).toBe("We don’t come to 400050 yet.");
    const pincode = page.querySelector("#address-pincode");
    expect(pincode?.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(pincode);
    expect(link("Join the waitlist")?.getAttribute("href")).toBe("https://maneman.in/book");
    expect(saved).toBe(0);
  });

  it("asks a client moving to another city while a visit is booked to message us first", async () => {
    refuseWith(409, "visit_booked");
    await save();

    expect(page.querySelector('[role="alert"]')?.textContent).toBe(
      "You have a visit booked in this city. To move to another, message us first.",
    );
    expect(link("Message us")?.getAttribute("href")).toContain("wa.me");
    expect(saved).toBe(0);
  });
});
