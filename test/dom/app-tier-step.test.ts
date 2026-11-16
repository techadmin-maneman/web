// A replacement's choice of hair system (apps/app/src/booking/steps/TierStep.tsx; ADR 0253): the one worn to keep, each
// other marked by how it compares, and what a change means: its price and life, its service, and the old one's fate;
// and, on the days, why they open late where its hair system is not in stock in the client's size.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDays, shortDate, todayInIndia } from "@maneman/web-kit/dates";
import type { Availability, OfferedService } from "../../apps/app/src/api.ts";
import { stockNoteOf } from "../../apps/app/src/booking/BookingSheet.tsx";
import {
  changeLine,
  howItCompares,
  TierChoices,
  wornOf,
  type Worn,
} from "../../apps/app/src/booking/steps/TierStep.tsx";
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

const pack = (code: string, months: number, service: number, every: number, replacement: number | null = null) => ({
  code,
  name: code,
  description: null,
  first_fit: price(30_000),
  service: price(service),
  service_every_days: every,
  replacement: replacement === null ? null : price(replacement),
  replace_after_months: months,
});

const PACKAGES = [pack("active", 6, 2000, 30), pack("natural", 6, 2500, 30), pack("essential", 4, 2000, 30)];

const TODAY = "2026-11-17";

const WORN_ME = {
  package: "active",
  name: "Mane Man Active",
  fitted_on: "2026-06-06",
  replace_after_months: 6,
  due_on: "2026-12-06",
  replacement_opens_on: "2026-12-01",
};

const WORN: Worn = { tier: "active", name: "Mane Man Active", price: 1_500_000 };

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

const draw = (picked: OfferedService | null, worn = WORN_ME, today = TODAY) => {
  act(() => {
    root.render(
      createElement(TierChoices, {
        services: [ACTIVE, NATURAL, ESSENTIAL],
        worn,
        packages: PACKAGES,
        chosen: picked,
        today,
        onChoose: (service: OfferedService) => chosen.push(service),
      }),
    );
  });
};

describe("a replacement's choice of hair system", () => {
  it("marks the one worn to keep, and each other by its price against it", () => {
    expect(howItCompares(ACTIVE, WORN)).toBe(copy.keep);
    expect(howItCompares(NATURAL, WORN)).toBe(copy.upgrade);
    expect(howItCompares(ESSENTIAL, WORN)).toBe(copy.downgrade);
    expect(howItCompares(PREMIUM, WORN)).toBe(copy.change);
  });

  it("prices the one worn by its package's figures where it is not on sale, and calls a change a switch without either", () => {
    const listed = [pack("classic", 6, 2000, 30, 14_000)];
    const worn = wornOf({ ...WORN_ME, package: "classic", name: "Mane Man Classic" }, [ACTIVE, NATURAL], listed);
    expect(worn).toEqual({ tier: "classic", name: "Mane Man Classic", price: 1_400_000 });
    expect(howItCompares(ACTIVE, worn)).toBe(copy.upgrade);
    expect(howItCompares(ACTIVE, { ...worn, price: null })).toBe(copy.change);
  });

  it("says when the one worn is due, and offers each as a card to choose, with its tag and facts", () => {
    draw(ACTIVE);
    expect(page.textContent).toContain(copy.due("Mane Man Active", "Sun 6 Dec"));
    const radios = [...page.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((radio) => radio.checked)).toEqual([true, false, false]);
    // The whole card is the choice: its facts are in its label.
    expect(radios[1]?.closest("label")?.textContent).toContain("6 months");
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

  it("says it was due, once its day has passed", () => {
    draw(ACTIVE, WORN_ME, "2026-12-09");
    expect(page.textContent).toContain(copy.wasDue("Mane Man Active", "Sun 6 Dec"));
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
    expect(changeLine(ESSENTIAL, WORN, PACKAGES)).toBe(
      [
        copy.costs("Rs. 12,000", 4),
        copy.serviceStays("Rs. 2,000", "every 30 days"),
        copy.oldBack("Mane Man Active"),
      ].join(" "),
    );
  });

  it("still offers the choice without the packages' facts", () => {
    expect(changeLine(NATURAL, WORN, [])).toBe(copy.oldBack("Mane Man Active"));
  });
});

describe("a replacement's days opening late", () => {
  const tomorrow = addDays(todayInIndia(Date.now()), 1);
  const days = (type: Availability["type"], opens: string) =>
    ({ type, opens, service: { tier: "natural", name: "Mane Man Natural", minutes: 135 } }) as Availability;

  it("says the hair system is not in stock in the client's size, and its earliest fitting", () => {
    const late = addDays(tomorrow, 9);
    expect(stockNoteOf(days("replacement", late), { ...WORN_ME, replacement_opens_on: tomorrow })).toBe(
      booking.when.notInStock("Mane Man Natural", shortDate(late)),
    );
  });

  it("says nothing where the days open on the replacement's own first day, or the visit is no replacement", () => {
    const opens = addDays(tomorrow, 3);
    expect(stockNoteOf(days("replacement", opens), { ...WORN_ME, replacement_opens_on: opens })).toBeNull();
    expect(stockNoteOf(days("replacement", tomorrow), null)).toBeNull();
    expect(stockNoteOf(days("service", addDays(tomorrow, 9)), WORN_ME)).toBeNull();
  });
});
