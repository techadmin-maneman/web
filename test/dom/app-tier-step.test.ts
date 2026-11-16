// A replacement's choice of hair system (apps/app/src/booking/steps/TierStep.tsx; ADR 0253): the one worn to keep, each
// other marked by how it compares, and what a change means: its price and life, its service, and the old one's fate.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OfferedService } from "../../apps/app/src/api.ts";
import { changeLine, howItCompares, TierChoices } from "../../apps/app/src/booking/steps/TierStep.tsx";
import { booking } from "../../apps/app/src/content.ts";

const copy = booking.tier;

const price = (rupees: number) => ({ amount_ex_gst: rupees * 100, amount: rupees * 100, gst_percent: 0 });

const offered = (tier: string, name: string, rupees: number): OfferedService => ({
  type: "replacement",
  tier,
  name,
  description: null,
  minutes: 135,
  price: price(rupees),
});

const ACTIVE = offered("active", "Mane Man Active", 15_000);
const NATURAL = offered("natural", "Mane Man Natural", 18_000);
const ESSENTIAL = offered("essential", "Mane Man Essential", 12_000);
const PREMIUM = offered("premium", "Mane Man Premium", 15_000);

const pack = (code: string, months: number, service: number, every: number) => ({
  code,
  name: code,
  description: null,
  first_fit: price(30_000),
  service: price(service),
  service_every_days: every,
  replacement: null,
  replace_after_months: months,
});

const PACKAGES = [pack("active", 6, 2000, 30), pack("natural", 6, 2500, 30), pack("essential", 4, 2000, 30)];

const WORN = {
  package: "active",
  name: "Mane Man Active",
  fitted_on: "2026-06-06",
  replace_after_months: 6,
  due_on: "2026-12-06",
  replacement_opens_on: "2026-12-01",
};

let page: HTMLDivElement;
let root: Root;
let chosen: OfferedService[];

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  chosen = [];
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
});

const draw = (picked: OfferedService | null) => {
  act(() => {
    root.render(
      createElement(TierChoices, {
        services: [ACTIVE, NATURAL, ESSENTIAL],
        worn: WORN,
        packages: PACKAGES,
        chosen: picked,
        onChoose: (service: OfferedService) => chosen.push(service),
      }),
    );
  });
};

describe("a replacement's choice of hair system", () => {
  it("marks the one worn to keep, and each other by its price against it", () => {
    expect(howItCompares(ACTIVE, ACTIVE)).toBe(copy.keep);
    expect(howItCompares(NATURAL, ACTIVE)).toBe(copy.upgrade);
    expect(howItCompares(ESSENTIAL, ACTIVE)).toBe(copy.downgrade);
    expect(howItCompares(PREMIUM, ACTIVE)).toBe(copy.change);
  });

  it("says when the one worn is due, and offers each with its tag and facts", () => {
    draw(ACTIVE);
    expect(page.textContent).toContain(copy.due("Mane Man Active", "Sun 6 Dec"));
    const radios = [...page.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((radio) => radio.checked)).toEqual([true, false, false]);
    expect(page.textContent).toContain(copy.keep);
    expect(page.textContent).toContain(copy.upgrade);
    expect(page.textContent).toContain(copy.downgrade);
    // Keeping it changes nothing, so nothing is said of a change.
    expect(page.querySelector('[role="status"]')).toBeNull();
    act(() => {
      radios[1]?.click();
    });
    expect(chosen).toEqual([NATURAL]);
  });

  it("says what a change means: its price and life, its service, and that the old one costs nothing", () => {
    draw(NATURAL);
    const said = page.querySelector('[role="status"]')?.textContent ?? "";
    expect(said).toContain(copy.from(copy.upgrade, "Mane Man Active", "Mane Man Natural"));
    expect(said).toContain(copy.costs("Rs. 18,000", 6));
    expect(said).toContain(copy.serviceChanges("Rs. 2,000", "every 30 days", "Rs. 2,500", "every 30 days"));
    expect(said).toContain(copy.oldBack("Mane Man Active"));
  });

  it("says a service that stays the same stays", () => {
    expect(changeLine(ESSENTIAL, ACTIVE, PACKAGES)).toBe(
      [
        copy.costs("Rs. 12,000", 4),
        copy.serviceStays("Rs. 2,000", "every 30 days"),
        copy.oldBack("Mane Man Active"),
      ].join(" "),
    );
  });

  it("still offers the choice without the packages' facts", () => {
    expect(changeLine(NATURAL, ACTIVE, [])).toBe(copy.oldBack("Mane Man Active"));
  });
});
