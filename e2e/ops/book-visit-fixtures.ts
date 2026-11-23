// What Book a visit's tests share (./book-visit.e2e.ts): the windows the API answers with, a link booking's answer,
// and the client's Visits tab with the panel opened from it.

import type { Page } from "@playwright/test";
import {
  answer,
  CLIENT,
  CONSENTS,
  json,
  PIECES,
  RECORD,
  TASKS_READ_ON,
  type Answers,
  type Call,
  type OpsReply,
} from "./fixtures.ts";

export const AVAILABILITY: Call = "GET /api/visits/availability";
export const HOLD = "44000000-0000-4000-8000-000000000001";
export const SANDEEP = { id: "t2", name: "Sandeep Rawat" };
export const IMRAN = { id: "t1", name: "Imran Qureshi" };

export const SERVICE_PRICE = { amount_ex_gst: 200_000, amount: 200_000, gst_percent: 0 };

/** A start and who can take it, adding no drive. */
export const at = (time: string, startsAt: string, technicians: readonly { id: string; name: string }[]) => ({
  time,
  starts_at: startsAt,
  technicians: technicians.map((each) => ({ ...each, added_drive_minutes: 0 })),
});

/** Two days of starts: Thursday's morning is full, its noon has both technicians. */
export const WINDOWS = {
  kind: "service",
  needs_profile: false,
  services: [{ tier: "standard", name: "Service visit", minutes: 90, price: SERVICE_PRICE }],
  service: { tier: "standard", name: "Service visit", minutes: 90 },
  recommended: null,
  pays: "link",
  credits: 0,
  owed: [],
  days: [
    {
      date: "2027-09-23",
      windows: [
        { window: "morning", start: "09:00", end: "12:00", technicians: [] },
        { window: "afternoon", start: "12:00", end: "16:00", technicians: [IMRAN, SANDEEP] },
        { window: "evening", start: "16:00", end: "20:00", technicians: [SANDEEP] },
      ],
      starts: [
        at("12:00", "2027-09-23T06:30:00.000Z", [IMRAN, SANDEEP]),
        at("12:30", "2027-09-23T07:00:00.000Z", [IMRAN]),
        at("16:00", "2027-09-23T10:30:00.000Z", [SANDEEP]),
      ],
    },
    {
      date: "2027-09-24",
      windows: [
        { window: "morning", start: "09:00", end: "12:00", technicians: [IMRAN] },
        { window: "afternoon", start: "12:00", end: "16:00", technicians: [] },
        { window: "evening", start: "16:00", end: "20:00", technicians: [] },
      ],
      starts: [at("09:00", "2027-09-24T03:30:00.000Z", [IMRAN]), at("09:30", "2027-09-24T04:00:00.000Z", [IMRAN])],
    },
  ],
} satisfies OpsReply<"/api/visits/availability">;

export const LINK_SENT = {
  hold_id: HOLD,
  outcome: "awaiting_payment",
  visit_id: null,
  pays: "link",
  service: WINDOWS.service,
  price: SERVICE_PRICE,
  date: "2027-09-23",
  window: "afternoon",
  starts_at: "2027-09-23T06:30:00.000Z",
  technician: SANDEEP,
  technician_draft: false,
  link: { url: "https://rzp.io/i/stub4417", open_until: "2027-09-23T04:30:00.000Z", texted: true },
} satisfies OpsReply<"/api/visits", "post", 201>;

export async function openVisits(page: Page, over: Answers = {}): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, {
    [`GET /api/clients/${CLIENT.id}`]: json(RECORD),
    [`GET /api/clients/${CLIENT.id}/pieces`]: json(PIECES),
    [`GET /api/clients/${CLIENT.id}/consents`]: json(CONSENTS),
    [AVAILABILITY]: json(WINDOWS),
    ...over,
  });
  await page.goto(`/clients/${CLIENT.id}/visits`);
}

export const panel = (page: Page) => page.getByRole("dialog", { name: `Book a visit for ${CLIENT.name}` });
