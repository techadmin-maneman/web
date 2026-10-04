// The console's panels for cancelling a client's visit and closing one by hand (apps/ops/src/clients). A cancel shows
// what it gives back before anything changes, free to the client unless ops tick the client's late terms, and goes
// only with a reason; a close by hand sends its times on the visit's own day in India.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CancelVisit } from "../../apps/ops/src/clients/CancelVisit.tsx";
import { CloseVisit } from "../../apps/ops/src/clients/CloseVisit.tsx";

const VISIT = "22222222-2222-4222-8222-222222222222";

/** A service visit paid Rs. 2,000 by UPI, inside the 24 hours: free to the client gives it all back. */
const LATE_TERMS = {
  visit_id: VISIT,
  type: "service",
  notice: "late",
  notice_hours: 24,
  paid: 200000,
  destination: "upi",
  free: { refund: 200000, kept: 0, credit: null },
  client_terms: { refund: 0, kept: 200000, credit: null },
  cancelled: false,
};

interface Sent {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

let page: HTMLElement;
let root: Root;
let sent: Sent[];
let answers: ((sent: Sent) => Response)[];
let closedWith: boolean[];

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom draws a <dialog> but cannot open one as a modal.
  Reflect.set(HTMLDialogElement.prototype, "showModal", function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  Reflect.set(HTMLDialogElement.prototype, "close", function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  sent = [];
  answers = [];
  closedWith = [];
  vi.stubGlobal("fetch", (url: string, init: { body: string }) => {
    const call = {
      path: new URL(url, "https://ops.maneman.test").pathname,
      body: JSON.parse(init.body) as Sent["body"],
    };
    sent.push(call);
    const reply = answers.shift();
    if (reply === undefined) throw new Error(`Nothing answers ${call.path}`);
    return Promise.resolve(reply(call));
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
  vi.restoreAllMocks();
});

const refusal = (status: number, code: string, fields: string[] = []) =>
  Response.json({ error: { code, message: code, request_id: "request-1", fields } }, { status });

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function show(panel: React.ReactElement) {
  act(() => {
    root.render(panel);
  });
  await settle();
}

const text = () => page.textContent;

function button(name: string): HTMLButtonElement {
  const found = [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === name);
  if (found === undefined) throw new Error(`No button "${name}" in: ${text()}`);
  return found;
}

/** The control a label names, as a screen reader finds it. */
function field(label: string): HTMLElement {
  const found = [...page.querySelectorAll("label")].find((each) => each.textContent.trim() === label);
  const control = found === undefined ? null : document.getElementById(found.htmlFor);
  if (control === null) throw new Error(`No field "${label}" in: ${text()}`);
  return control;
}

/** As a keystroke does: React hears a change only through the control's own value setter. */
function fill(label: string, value: string) {
  const control = field(label);
  const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Reflect.set(prototype, "value", value, control);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function tick(label: string) {
  act(() => {
    field(label).click();
  });
}

async function press(name: string) {
  act(() => {
    button(name).click();
  });
  await settle();
}

const cancelPanel = () =>
  createElement(CancelVisit, {
    visitId: VISIT,
    name: "Rohit Malhotra",
    onClose: (cancelled: boolean) => closedWith.push(cancelled),
  });

describe("cancelling a client's visit from the console", () => {
  it("shows what goes back free to the client before anything changes", async () => {
    answers.push(() => Response.json(LATE_TERMS));
    await show(cancelPanel());

    expect(sent).toEqual([{ path: `/api/visits/${VISIT}/cancel`, body: { confirm: false } }]);
    expect(text()).toContain("Paid Rs. 2,000 by UPI.");
    expect(text()).toContain("Free to the client: Rs. 2,000 goes back to their UPI.");
  });

  it("asks for a reason, then cancels free to the client and says what went back", async () => {
    answers.push(() => Response.json(LATE_TERMS));
    await show(cancelPanel());
    expect(button("Cancel the visit").disabled).toBe(true);

    fill("Why", "Client phoned: his father is unwell");
    answers.push(() => Response.json({ ...LATE_TERMS, cancelled: true }));
    await press("Cancel the visit");

    expect(sent[1]).toEqual({
      path: `/api/visits/${VISIT}/cancel`,
      body: { confirm: true, notice: "late", reason: "Client phoned: his father is unwell" },
    });
    expect(text()).toContain("Cancelled. Rs. 2,000 goes back to their UPI.");
    await press("Close");
    expect(closedWith).toEqual([true]);
  });

  it("applies the client's late terms only when ops tick them, and says what is kept", async () => {
    answers.push(() => Response.json(LATE_TERMS));
    await show(cancelPanel());

    tick("Apply the client's late terms");
    expect(text()).toContain("On their late terms: Rs. 2,000 is kept.");
    fill("Why", "Cancelled an hour before; no reason given");
    answers.push(() => Response.json({ ...LATE_TERMS, cancelled: true }));
    await press("Cancel the visit");

    expect(sent[1]?.body).toEqual({
      confirm: true,
      notice: "late",
      on_client_terms: true,
      reason: "Cancelled an hour before; no reason given",
    });
  });

  it("offers no late terms where the client's own would give the same back", async () => {
    const inTime = { ...LATE_TERMS, notice: "free", client_terms: LATE_TERMS.free };
    answers.push(() => Response.json(inTime));
    await show(cancelPanel());

    expect(text()).not.toContain("late terms");
  });

  it("says a visit paid with a credit gets its credit back", async () => {
    const credit = { refund: 0, kept: 0 };
    const terms = {
      ...LATE_TERMS,
      paid: 0,
      destination: null,
      free: { ...credit, credit: "restored" },
      client_terms: { ...credit, credit: "lost" },
    };
    answers.push(() => Response.json(terms));
    await show(cancelPanel());

    expect(text()).toContain("Paid with a free service visit.");
    expect(text()).toContain("Free to the client: their free service visit comes back.");
    tick("Apply the client's late terms");
    expect(text()).toContain("On their late terms: their free service visit is spent.");
  });

  it("says why a visit cannot be cancelled, and changes nothing", async () => {
    answers.push(() => refusal(409, "not_changeable"));
    await show(cancelPanel());

    expect(text()).toContain("This visit can no longer be cancelled");
    expect(() => button("Cancel the visit")).toThrow();
  });

  it("reads the terms again when the notice changed while the panel was open", async () => {
    answers.push(() => Response.json({ ...LATE_TERMS, notice: "free", client_terms: LATE_TERMS.free }));
    await show(cancelPanel());
    fill("Why", "Client phoned");
    answers.push(() => refusal(409, "terms_changed"));
    answers.push(() => Response.json(LATE_TERMS));
    await press("Cancel the visit");
    await settle();

    expect(sent.map((each) => each.body.confirm)).toEqual([false, true, false]);
    expect(text()).toContain("The client's notice ran out while this was open.");
    expect(text()).toContain("Apply the client's late terms");
  });
});

const closePanel = () =>
  createElement(CloseVisit, {
    visitId: VISIT,
    name: "Rohit Malhotra",
    date: "2026-09-21",
    onClose: (closed: boolean) => closedWith.push(closed),
  });

describe("closing a visit by hand from the console", () => {
  it("sends the times on the visit's own day in India, the outcome and the reason", async () => {
    await show(closePanel());
    expect(button("Close the visit").disabled).toBe(true);

    fill("Work began at", "09:20");
    fill("Work ended at", "10:50");
    fill("What happened, and how you know", "Imran's phone was stolen; the client confirmed the visit");
    answers.push(() => Response.json({ visit_id: VISIT, status: "completed", duration_minutes: 90 }));
    await press("Close the visit");

    expect(sent).toEqual([
      {
        path: `/api/visits/${VISIT}/close`,
        body: {
          outcome: "done",
          started_at: "2026-09-21T03:50:00.000Z",
          ended_at: "2026-09-21T05:20:00.000Z",
          reason: "Imran's phone was stolen; the client confirmed the visit",
        },
      },
    ]);
    expect(text()).toContain("Closed as done.");
    await press("Close");
    expect(closedWith).toEqual([true]);
  });

  it("closes a visit as partly done, whose follow-up waits on Tasks", async () => {
    await show(closePanel());
    tick("Partly done");
    fill("Work began at", "09:20");
    fill("Work ended at", "10:00");
    fill("What happened, and how you know", "Phone lost mid-visit; the client had to leave");
    answers.push(() => Response.json({ visit_id: VISIT, status: "terminated", duration_minutes: 40 }));
    await press("Close the visit");

    expect(sent[0]?.body.outcome).toBe("partial");
    expect(text()).toContain("Closed as partly done. Its follow-up waits on Tasks.");
  });
});
