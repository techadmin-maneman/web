// What the ops routes answer in these tests. The figures are the Ops Console
// board's own (design/phase2/Ops Console.dc.html, B2, B3 and C1 to C3), so a
// test reads beside the drawing; nothing here is a real person, number,
// address or photograph.
//
// The queues the console reads are empty on a fresh local database, and
// seeding a held grant or a client's photographs would mean writing rows no
// route creates. So the tests that need them answer the API themselves, as
// e2e/app's do for a state the API cannot be put into.

import type { Page, Route } from "@playwright/test";
import sharp from "sharp";

export const HELD = {
  held: [
    {
      id: "aa000000-0000-4000-8000-000000000001",
      referrer: { person_id: "11000000-0000-4000-8000-000000000001", name: "Rohit Malhotra" },
      referred: { person_id: "11000000-0000-4000-8000-000000000002", name: "Vikram Sethi" },
      fitted_on: "2027-09-19",
      signals: ["shared_address"],
    },
    {
      id: "aa000000-0000-4000-8000-000000000002",
      referrer: { person_id: "11000000-0000-4000-8000-000000000003", name: "Ashish Gill" },
      referred: { person_id: "11000000-0000-4000-8000-000000000004", name: "Manoj Gill" },
      fitted_on: "2027-09-21",
      signals: ["shared_upi"],
    },
    {
      id: "aa000000-0000-4000-8000-000000000003",
      referrer: { person_id: "11000000-0000-4000-8000-000000000005", name: "Karan Bose" },
      referred: { person_id: "11000000-0000-4000-8000-000000000006", name: "Nikhil Arora" },
      fitted_on: "2027-09-22",
      signals: ["monthly_cap"],
    },
  ],
};

export const REFERRERS = {
  referrers: [
    { code: "KB1102", name: "Karan Bose", opens: 19, consultations: 9, fits: 6, granted: 15, redeemed: 2 },
    { code: "RM4417", name: "Rohit Malhotra", opens: 7, consultations: 3, fits: 2, granted: 6, redeemed: 4 },
    { code: "AG2208", name: "Ashish Gill", opens: 4, consultations: 2, fits: 1, granted: 3, redeemed: 3 },
    { code: "VS0916", name: "Vikram Sethi", opens: 1, consultations: 0, fits: 0, granted: 0, redeemed: 0 },
  ],
};

export const AREAS = {
  areas: [
    {
      pincode: "400050",
      area: "Bandra W",
      city: "Mumbai",
      served: false,
      launched_at: null,
      waiting: 117,
      oldest: "2027-02-04T06:00:00.000Z",
      referred: 31,
      alerts: 84,
    },
    {
      pincode: "400026",
      area: "Cumballa",
      city: "Mumbai",
      served: false,
      launched_at: null,
      waiting: 64,
      oldest: "2027-03-19T06:00:00.000Z",
      referred: 12,
      alerts: 41,
    },
    {
      pincode: "122018",
      area: "Sector 65",
      city: "Gurgaon",
      served: true,
      launched_at: "2026-11-01T06:00:00.000Z",
      waiting: 4,
      oldest: "2027-05-11T06:00:00.000Z",
      referred: 1,
      alerts: 2,
    },
  ],
};

export const PREVIEW = { pincode: "400050", waiting: 117, alerts: 84, launched: false };
export const LAUNCHED = { pincode: "400050", waiting: 117, alerts: 84, launched: true };

// ---- Boards B2 and B3: one client's page ------------------------------------

/** The board's client, on a number nobody holds. */
export const CLIENT = { id: "22000000-0000-4000-8000-000000000001", name: "Rohit Malhotra", mobile: "+919810004417" };

const TECHNICIAN = { name: "Imran Qureshi", initials: "IQ" };
const VISIT_ID = "33000000-0000-4000-8000-000000000001";

export const RECORD = {
  ...CLIENT,
  state: "fitted",
  known_since: "2026-11-01T06:00:00.000Z",
  address: {
    line1: "House 1204",
    line2: null,
    locality: "Sector 65",
    city: "Gurgaon",
    pincode: "122018",
    access_notes: "Gate 4417, bay B",
  },
  credits: { visits: 2, earliest_expiry: "2028-01-03T06:00:00.000Z" },
  visits: {
    upcoming: [],
    past: [
      {
        id: VISIT_ID,
        date: "2027-08-22",
        window_label: "morning",
        starts_at: "2027-08-22T03:30:00.000Z",
        ends_at: "2027-08-22T05:00:00.000Z",
        length_minutes: 90,
        type: "service",
        status: "completed",
        technician: TECHNICIAN,
        place: "Sector 65, Gurgaon 122018",
        outcome: "done",
      },
    ],
  },
  payments: [],
};

const ANGLES = ["front", "top", "left", "right", "hair"] as const;
const PHASES = ["before", "after"] as const;

const photo = (phase: string, angle: string, n: number) => ({
  id: `44000000-0000-4000-8000-00000000000${String(n)}`,
  phase,
  angle,
  width: 600,
  height: 800,
  taken_at: "2027-08-22T04:30:00.000Z",
});

export const PHOTOS = {
  visits: [
    {
      visit_id: VISIT_ID,
      date: "2027-08-22",
      type: "service",
      technician: TECHNICIAN,
      photos: PHASES.flatMap((phase, set) => ANGLES.map((angle, n) => photo(phase, angle, set * 5 + n))),
    },
  ],
};

export const CONSENTS = {
  consents: [
    {
      purpose: "photos_own_record",
      state: "given",
      notice_version: "photos-own-record-v1",
      at: "2026-11-14T08:00:00.000Z",
    },
    {
      purpose: "photos_referral_cards",
      state: "given",
      notice_version: "photos-referral-cards-v2",
      at: "2027-08-03T08:00:00.000Z",
    },
    { purpose: "photos_marketing", state: "not_given", notice_version: null, at: null },
    {
      purpose: "whatsapp_visits",
      state: "given",
      notice_version: "whatsapp-visits-v1",
      at: "2026-11-02T08:00:00.000Z",
    },
    {
      purpose: "whatsapp_launches",
      state: "withdrawn",
      notice_version: "whatsapp-launches-v1",
      at: "2027-01-11T08:00:00.000Z",
    },
  ],
  deletion: null,
};

export const ERASURE_REQUESTED = {
  ...CONSENTS,
  deletion: {
    id: "55000000-0000-4000-8000-000000000001",
    state: "requested",
    requested_at: "2027-09-18T08:00:00.000Z",
    decided_at: null,
  },
};

/** A photograph that is a block of ink, so no test holds a picture of anyone. */
export const inkPhoto = () =>
  sharp({ create: { width: 600, height: 800, channels: 3, background: "#16233a" } })
    .jpeg()
    .toBuffer();

type Answers = Readonly<Record<string, (route: Route) => Promise<void>>>;

export const json = (body: unknown) => (route: Route) => route.fulfill({ json: body });
export const jpeg = (body: Buffer) => (route: Route) => route.fulfill({ body, contentType: "image/jpeg" });
export const fails = (status: number, code: string) => (route: Route) =>
  route.fulfill({ status, json: { error: { code, request_id: "test" } } });

/** Answers the console's calls from `answers`, by path; anything else goes to the local mm-api. */
export async function answer(page: Page, answers: Answers): Promise<void> {
  await page.route("**/api/**", (route) => {
    const reply = answers[new URL(route.request().url()).pathname];
    return reply === undefined ? route.continue() : reply(route);
  });
}
