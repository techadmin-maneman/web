// What the site booking tests share (consultations*.test.ts, public-availability.test.ts): a visitor, the address
// they type, the site app and the pincodes it books at.

import { env } from "cloudflare:workers";
import { appFor, fakeDependencies } from "../helpers.ts";

export const VISITOR = {
  name: "Karan Bhatia",
  mobile: "9810000002",
  loss_extent: "crown",
  turnstile_token: "token",
};

/** Where the consultation is, typed in full as the form takes it (ADR 0081). */
export const ADDRESS = {
  flat: "Flat 402",
  floor: "4",
  tower: "Tower C",
  line1: "Palm Grove Society",
  line2: null,
  landmark: "Opposite the park",
  locality: "Sector 65",
  city: "Gurgaon",
  pincode: "122018",
  access_notes: "Gate 2, visitor parking",
};

/** What every number is answered for 23 September's morning, whether we know it or not. */
export const BOOKED_MORNING = {
  state: "booked",
  date: "2026-09-23",
  window: "morning",
  area: "Gurgaon South City II",
  credits: false,
  invite: "unknown",
  one_visit: false,
  discount_code: null,
};

export const site = (settings = {}) => appFor("local", fakeDependencies(), settings, "public");

export const post = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** A pincode whose area ops have named, unless `named` is false: its name is then still the post offices'. */
export async function pincode(pin: string, area: string, city: string, served: boolean, named = true) {
  await env.DB.prepare(
    `INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at, area_named_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(pin, area, city, served ? 1 : 0, served ? "2026-09-01T18:30:00.000Z" : null, named ? "ops@localhost" : null)
    .run();
}
