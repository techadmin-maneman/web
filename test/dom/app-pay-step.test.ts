// The booking sheet's review (apps/app/src/booking/steps/PayStep.tsx): what it says a visit costs, now and if it is
// changed later, a payment that failed, the ways back, and when Pay can be tapped.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hold, MoveTerms } from "../../apps/app/src/api.ts";
import { PayStep } from "../../apps/app/src/booking/steps/PayStep.tsx";
import { booking } from "../../apps/app/src/content.ts";
import { rupees } from "../../packages/web-kit/money.ts";
import { holdOf, minutesFromNow } from "./app-holds.ts";

const copy = booking.pay;

let page: HTMLElement;
let root: Root;
let paid: number;
let reminded: boolean[];
let tapped: string[];

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  // The DOM here draws nothing, so there is nothing to scroll; a failed payment's notice asks to be brought into view.
  Reflect.set(Element.prototype, "scrollIntoView", () => undefined);
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  paid = 0;
  reminded = [];
  tapped = [];
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
});

const ADDRESS = {
  line1: "Flat 4B, Sea Breeze",
  line2: null,
  locality: "Bandra West",
  city: "Mumbai",
  pincode: "400050",
  access_notes: null,
};

const draw = (
  hold: Hold,
  over: {
    busy?: boolean;
    problem?: string | null;
    askToRemind?: boolean;
    failed?: boolean;
    unfinished?: boolean;
    leavable?: boolean;
    moving?: MoveTerms;
  } = {},
) => {
  act(() => {
    root.render(
      createElement(PayStep, {
        hold,
        moving: over.moving,
        address: ADDRESS,
        failed: over.failed ?? false,
        unfinished: over.unfinished ?? false,
        step: { at: 2, of: 2 },
        onBack: over.leavable === false ? undefined : () => tapped.push("back"),
        onClose: () => tapped.push("close"),
        onChangeAddress: over.leavable === false ? undefined : () => tapped.push("address"),
        busy: over.busy ?? false,
        problem: over.problem ?? null,
        askToRemind: over.askToRemind ?? false,
        remind: false,
        onRemind: (remind: boolean) => reminded.push(remind),
        onPay: () => (paid += 1),
        onHold: () => undefined,
      }),
    );
  });
};

/** The step's one primary button: Pay, or Confirm for a visit that costs nothing. */
const payButton = () => {
  const button = [...page.querySelectorAll("button")].find(
    (each) => each.textContent.startsWith(copy.pay("")) || each.textContent === copy.confirm,
  );
  if (button === undefined) throw new Error("no Pay button");
  return button;
};

/** Ticks the box that agrees to the terms and the privacy policy. */
const agree = () => {
  const box = [...page.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((each) =>
    each.closest("label")?.textContent.includes(copy.agree.terms),
  );
  if (box === undefined) throw new Error("no agreement");
  act(() => {
    box.click();
  });
};

describe("the review", () => {
  it("asks a visit's price, and pays at a tap once the terms are agreed to", () => {
    draw(holdOf());
    expect(payButton().textContent).toBe(copy.pay(rupees(200000)));
    agree();
    act(() => {
      payButton().click();
    });
    expect(paid).toBe(1);
  });

  // Counsel asks for a tick of the client's own wherever they pay, the terms and the privacy policy each a link.
  it("holds Pay until the client agrees to the terms and the privacy policy, each a link in a new tab", () => {
    draw(holdOf());
    expect(payButton().disabled).toBe(true);
    const links = [...page.querySelectorAll("a")].filter((link) => /\/(terms|privacy)$/.test(link.href));
    expect(links.map((link) => [link.textContent, link.target])).toEqual([
      [copy.agree.terms, "_blank"],
      [copy.agree.privacy, "_blank"],
    ]);
    agree();
    expect(payButton().disabled).toBe(false);
  });

  it("confirms a visit a free service visit covers, with the credit it uses and no code box", () => {
    draw(holdOf({ credit: { remaining: 2 } }));
    expect(payButton().textContent).toBe(copy.confirm);
    expect(page.textContent).toContain(copy.credit.used);
    expect(page.textContent).toContain(copy.credit.remaining(2));
    expect(page.textContent).toContain(copy.credit.note(24));
    expect(page.textContent).not.toContain(copy.code.open);
  });

  it("says when changes stop being free, and what is kept after that", () => {
    draw(holdOf());
    expect(page.textContent).toContain(copy.afterThat.trim());
    expect(page.textContent).not.toContain("hours away");
  });

  it("says at once what a change keeps for a visit already inside its notice", () => {
    draw(holdOf({ free_until: minutesFromNow(-5) }));
    expect(page.textContent).toContain(copy.insideNotice.payment(24, rupees(200000)));
  });

  it("says a change is free at any time where ops sold it so", () => {
    draw(holdOf({ late_change_charge: "nothing" }));
    expect(page.textContent).toContain(copy.freeAnyTime);
  });

  it("asks to remind the client on WhatsApp, with the notice a link away, and passes on the tick", () => {
    draw(holdOf(), { askToRemind: true });
    const box = page.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.closest("label")?.textContent).toContain(copy.remind);
    expect([...page.querySelectorAll("a")].some((link) => link.href.endsWith("#whatsapp"))).toBe(true);
    act(() => {
      box?.click();
    });
    expect(reminded).toEqual([true]);
  });

  it("shows the problem it was given, as an alert", () => {
    draw(holdOf(), { problem: booking.creditGone });
    expect(page.querySelector('[role="alert"]')?.textContent).toBe(booking.creditGone);
  });

  it("holds Pay while the booking is starting, and once the hold has run out", () => {
    draw(holdOf(), { busy: true });
    expect(payButton().disabled).toBe(true);
    draw(holdOf({ expires_at: minutesFromNow(-1) }));
    expect(payButton().disabled).toBe(true);
    draw(holdOf());
    agree();
    expect(payButton().disabled).toBe(false);
  });

  it("lists the visit, when, who comes and where, with a way to change the address", () => {
    draw(holdOf());
    const facts = [...page.querySelectorAll("dt")].map((term) => term.textContent);
    expect(facts.slice(0, 4)).toEqual([copy.visit, copy.when, copy.technician, copy.address]);
    expect(page.textContent).toContain(copy.assigned);
    expect(page.textContent).toContain(ADDRESS.line1);
    const change = [...page.querySelectorAll("button")].find((button) => button.textContent === copy.changeAddress);
    act(() => {
      change?.click();
    });
    expect(tapped).toEqual(["address"]);
  });

  it("says a payment that failed at its head, Pay trying again", () => {
    draw(holdOf(), { failed: true });
    expect(page.querySelector('[role="alert"]')?.textContent).toContain(booking.failed.title);
    agree();
    act(() => {
      payButton().click();
    });
    expect(paid).toBe(1);
  });

  it("steps back to the day and time", () => {
    draw(holdOf());
    const back = page.querySelector<HTMLButtonElement>(`button[aria-label="${booking.back}"]`);
    act(() => {
      back?.click();
    });
    expect(tapped).toEqual(["back"]);
  });

  it("offers no way back, nor a change of address, while the hold may not be left", () => {
    draw(holdOf(), { leavable: false });
    expect(page.querySelector(`button[aria-label="${booking.back}"]`)).toBeNull();
    expect([...page.querySelectorAll("button")].some((button) => button.textContent === copy.changeAddress)).toBe(
      false,
    );
  });

  it("says the time is still held once Checkout is closed unpaid", () => {
    draw(holdOf(), { unfinished: true });
    const said = [...page.querySelectorAll('[role="status"]')].map((status) => status.textContent);
    expect(said).toContain(copy.notCompleted);
  });

  // A move keeps its visit's own address, which the profile's may no longer be, free, late or charged alike.
  it("shows a move no address, and no way to change it", () => {
    const move = (cost: MoveTerms["cost"]): MoveTerms => ({
      visit_id: "visit-1",
      type: "service",
      notice: cost === "free" ? "free" : "late",
      notice_hours: 24,
      free_until: minutesFromNow(60),
      paid: 200000,
      credit: null,
      cost,
      price: { amount_ex_gst: 0, amount: 0, gst_percent: 0 },
    });
    for (const cost of ["free", "late_fee", "charged"] as const) {
      draw(holdOf(), { moving: move(cost) });
      expect(page.textContent).not.toContain(ADDRESS.line1);
      const terms = [...page.querySelectorAll("dt")].map((term) => term.textContent);
      expect(terms).not.toContain(copy.address);
      expect([...page.querySelectorAll("button")].some((button) => button.textContent === copy.changeAddress)).toBe(
        false,
      );
    }
  });
});
