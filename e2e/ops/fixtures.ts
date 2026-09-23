// What the ops routes answer in these tests. The figures are the Ops Console
// board's own (design/phase2/Ops Console.dc.html, C1 to C3), so a test reads
// beside the drawing; nothing here is a real person, number or address.
//
// The queues the console reads are empty on a fresh local database, and
// seeding a held grant would mean writing rows no route creates. So the tests
// that need a full queue answer the API themselves, as e2e/app's do for a
// state the API cannot be put into.

import type { Page, Route } from "@playwright/test";

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

type Answers = Readonly<Record<string, (route: Route) => Promise<void>>>;

export const json = (body: unknown) => (route: Route) => route.fulfill({ json: body });
export const fails = (status: number, code: string) => (route: Route) =>
  route.fulfill({ status, json: { error: { code, request_id: "test" } } });

/** Answers the console's calls from `answers`, by path; anything else goes to the local mm-api. */
export async function answer(page: Page, answers: Answers): Promise<void> {
  await page.route("**/api/**", (route) => {
    const reply = answers[new URL(route.request().url()).pathname];
    return reply === undefined ? route.continue() : reply(route);
  });
}
