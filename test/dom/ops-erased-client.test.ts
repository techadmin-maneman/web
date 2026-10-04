// What the console shows of a client once erased (PS-18, OIA-18 and CP-35 of the audit, 2 October 2026): their page
// once read "We could not load this. Try again", which reads as a fault, and a deletion decided in the queue said
// nothing at all. Every name and number here is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientVisit, DeletionRequest, ErasedClientRecord, HeldBooking } from "../../apps/ops/src/api.ts";
import { ErasedRecord } from "../../apps/ops/src/clients/Erase.tsx";
import { DeletionsScreen } from "../../apps/ops/src/deletions/DeletionsScreen.tsx";

const PERSON = "11111111-1111-4111-8111-111111111111";

const visit = (changes: Partial<ClientVisit>): ClientVisit => ({
  id: "22222222-2222-4222-8222-222222222222",
  date: "2026-09-10",
  window_label: "morning",
  starts_at: "2026-09-10T04:30:00.000Z",
  ends_at: "2026-09-10T07:30:00.000Z",
  length_minutes: 180,
  type: "service",
  service: null,
  status: "completed",
  stage: null,
  prepaid: true,
  technician: { name: "Imran Qureshi", initials: "IQ" },
  place: "Gurgaon 122018",
  outcome: "done",
  closed_without_follow_up: null,
  discount_code: null,
  price_open: false,
  requested_code: null,
  ...changes,
});

/** Erased on 2 October 2026, with a visit still to come that ops erased despite, a visit done and its payment. */
const ERASED: ErasedClientRecord = {
  id: PERSON,
  erased_at: "2026-10-02T06:00:00.000Z",
  visits: {
    upcoming: [
      visit({
        id: "22222222-2222-4222-8222-222222222223",
        date: "2027-09-25",
        starts_at: "2027-09-25T03:30:00.000Z",
        ends_at: "2027-09-25T06:30:00.000Z",
        status: "scheduled",
        stage: "booked",
        outcome: null,
      }),
    ],
    past: [visit({})],
  },
  payments: [
    {
      kind: "payment",
      id: "55555555-5555-4555-8555-555555555555",
      date: "2026-09-09",
      amount: 236000,
      amount_ex_gst: 200000,
      gst_percent: 18,
      visit: { id: "22222222-2222-4222-8222-222222222222", date: "2026-09-10", type: "service" },
      booking: null,
      status: "captured",
      method: "upi",
      reference: "MM-2026-0841",
      refunded_amount: 0,
      purpose: "visit",
      charge: null,
      no_show: null,
      discount_code: null,
    },
  ],
  payment_links: [],
  invoices: [],
  held_bookings: [],
};

/** A free service visit FSM refused before they were erased, still holding its slot. */
const HELD: HeldBooking = {
  id: "66666666-6666-4666-8666-666666666666",
  type: "service",
  service: "Service visit",
  starts_at: "2027-09-24T08:30:00.000Z",
  window: "afternoon",
  paid: 0,
  uses_credit: false,
  moves_visit: false,
  held_at: "2026-10-02T05:03:00.000Z",
  refusal: "Zoho 400 INVALID_DATA",
  retries_end: "2026-10-03T05:03:00.000Z",
  retrying: false,
  discount_code: null,
};

const REQUEST: DeletionRequest = {
  id: "33333333-3333-4333-8333-333333333333",
  person_id: PERSON,
  name: "Rohit Malhotra",
  mobile: "+919810000001",
  requested_at: "2026-09-30T06:00:00.000Z",
  due: "2026-10-07T06:00:00.000Z",
};

let page: HTMLElement;
let root: Root;
let answers: Map<string, () => Response>;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  answers = new Map();
  // Anything not answered here is refused, as the API refuses a call it cannot serve.
  vi.stubGlobal("fetch", (url: string, init?: { method?: string }) => {
    const path = new URL(url, "https://ops.maneman.test").pathname;
    const reply = answers.get(`${init?.method ?? "GET"} ${path}`);
    const refused = () => Response.json({ error: { code: "unavailable", request_id: "request-1" } }, { status: 503 });
    return Promise.resolve((reply ?? refused)());
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
});

async function show(element: React.ReactElement) {
  act(() => {
    root.render(element);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const buttonNamed = (name: string) =>
  [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === name);

describe("an erased client's page", () => {
  it("says when they were erased, and keeps their visits and money, with nothing to call or message", async () => {
    await show(createElement(ErasedRecord, { record: ERASED, onChanged: () => undefined }));

    expect(page.querySelector("h2")?.textContent).toBe("Erased client");
    expect(page.textContent).toContain("Erased on 2 Oct 2026.");
    expect(page.textContent).toContain("MM-2026-0841");
    expect(page.textContent).toContain("Imran Qureshi");
    expect(page.textContent).not.toContain("could not load");
    expect(page.textContent).not.toContain("erased:");
    expect(page.querySelector('a[href^="tel:"], a[href*="wa.me"]')).toBeNull();
  });

  it("lets ops cancel a visit still to come, as erasing despite one promised", async () => {
    await show(createElement(ErasedRecord, { record: ERASED, onChanged: () => undefined }));

    expect(buttonNamed("Cancel")).toBeDefined();
  });

  // A live finding of 4 October 2026: the alert about a booking held for a client erased since sent ops to this page,
  // which had nothing to act on.
  it("shows a booking still held for them, which ops may refund", async () => {
    await show(
      createElement(ErasedRecord, { record: { ...ERASED, held_bookings: [HELD] }, onChanged: () => undefined }),
    );

    expect(page.textContent).toContain("Not in FSM yet");
    const buttons = [...page.querySelectorAll("button")].map((each) => each.textContent);
    expect(buttons.some((text) => text.startsWith("Refund it"))).toBe(true);
  });
});

describe("a deletion decided in the queue", () => {
  it("says the account is deleted, and what follows", async () => {
    answers.set("GET /api/deletion-requests", () => Response.json({ requests: [REQUEST] }));
    answers.set(`POST /api/deletion-requests/${REQUEST.id}/decision`, () => Response.json({ state: "done" }));
    await show(createElement(DeletionsScreen));

    act(() => {
      buttonNamed("Delete the account")?.click();
    });
    const check = [...page.querySelectorAll("label")].find((label) =>
      label.textContent.includes("I have confirmed this request"),
    );
    act(() => {
      check?.click();
    });
    await act(async () => {
      buttonNamed("Delete this account")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(page.querySelector('[role="status"]')?.textContent).toBe(
      "Account deleted. The client is told on WhatsApp, and the CRM and Books are blanked within minutes.",
    );
    expect(page.textContent).toContain("No deletion request is waiting.");
    expect(page.textContent).not.toContain("Rohit Malhotra");
  });
});
