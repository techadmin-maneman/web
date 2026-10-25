// The booking sheet's pay step (apps/app/src/booking/steps/PayStep.tsx): what it says a visit costs, now and if it is
// changed later, and when Pay can be tapped.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hold } from "../../apps/app/src/api.ts";
import { PayStep } from "../../apps/app/src/booking/steps/PayStep.tsx";
import { booking } from "../../apps/app/src/content.ts";
import { rupees } from "../../packages/web-kit/money.ts";
import { holdOf, minutesFromNow } from "./app-holds.ts";

const copy = booking.pay;

let page: HTMLElement;
let root: Root;
let paid: number;
let reminded: boolean[];

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  paid = 0;
  reminded = [];
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
});

const draw = (hold: Hold, over: { busy?: boolean; problem?: string | null; askToRemind?: boolean } = {}) => {
  act(() => {
    root.render(
      createElement(PayStep, {
        hold,
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

describe("the pay step", () => {
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
});
