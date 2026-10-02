// Where each record is, for staff access by place (src/domain/places.ts): a city, found through a pincode. Every
// name, number and ID is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { cityOf, reachBinding, withinReach, type PlacedRecord } from "../../src/domain/places.ts";
import type { PlacesReached } from "../../src/policy/access.ts";
import { markDatabase, NOW } from "./helpers.ts";

const AT = NOW.toISOString();
const EARLIER = "2026-08-01T06:30:00.000Z";

const GURGAON = "122002";
const DELHI = "110017";
const NOIDA = "201301";
/** A pincode outside the service area's list, so in none of our cities. */
const MUMBAI = "400001";

const ROWS = [
  `INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES
     ('${GURGAON}', 'DLF Phase 1', 'Gurgaon', 1), ('${DELHI}', 'Saket', 'Delhi', 1), ('${NOIDA}', 'Sector 18', 'Noida', 0)`,
  `INSERT INTO people (id, created_at, mobile_e164, name) VALUES
     ('arjun', '${AT}', '+919810000001', 'Arjun Mehta'),
     ('rohit', '${AT}', '+919810000002', 'Rohit Malhotra'),
     ('meera', '${AT}', '+919810000003', 'Meera Iyer'),
     ('kabir', '${AT}', '+919810000004', 'Kabir Singh'),
     ('neha', '${AT}', '+919810000005', 'Neha Kapoor'),
     ('zoya', '${AT}', '+919810000006', 'Zoya Khan')`,
  // Arjun moved from Delhi to Gurgaon; Neha's address is in no city of ours.
  `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode, replaced_at) VALUES
     ('arjun-before', 'arjun', '${EARLIER}', '4 B Road', 'Saket', 'Delhi', '${DELHI}', '${AT}'),
     ('arjun-now', 'arjun', '${AT}', '1 A Road', 'DLF Phase 1', 'Gurgaon', '${GURGAON}', NULL),
     ('neha-now', 'neha', '${AT}', '9 Marine Drive', 'Fort', 'Mumbai', '${MUMBAI}', NULL)`,
  `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at, city) VALUES
     ('t-gurgaon', 't-gurgaon', 'Imran Qureshi', 'IQ', 1, '${AT}', 'Gurgaon'),
     ('t-none', 't-none', 'Sameer Bhatt', 'SB', 1, '${AT}', NULL)`,
  // Arjun's visit at his old Delhi address; Rohit's latest in Noida, after one in Delhi; Zoya's with no pincode.
  `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status, synced_at,
     service_pincode) VALUES
     ('v-delhi', 'v-delhi', 'arjun', 'service', '2026-09-10T03:30:00.000Z', '2026-09-10T05:00:00.000Z', 't-gurgaon',
      'completed', '${AT}', '${DELHI}'),
     ('v-rohit-before', 'v-rohit-before', 'rohit', 'consultation', '2026-08-10T03:30:00.000Z',
      '2026-08-10T04:30:00.000Z', 't-gurgaon', 'completed', '${AT}', '${DELHI}'),
     ('v-noida', 'v-noida', 'rohit', 'service', '2026-09-15T03:30:00.000Z', '2026-09-15T05:00:00.000Z', 't-gurgaon',
      'completed', '${AT}', '${NOIDA}'),
     ('v-none', 'v-none', 'zoya', 'consultation', '2026-09-16T03:30:00.000Z', '2026-09-16T04:30:00.000Z', 't-gurgaon',
      'completed', '${AT}', NULL)`,
  // Rohit's Delhi waitlist entry is older than his visits, which say where he is.
  `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, created_at) VALUES
     ('w-meera', '${DELHI}', 'meera', '${AT}', '${AT}'),
     ('w-rohit', '${DELHI}', 'rohit', '${EARLIER}', '${EARLIER}'),
     ('w-neha', '${GURGAON}', 'neha', '${AT}', '${AT}')`,
  `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at) VALUES
     ('ask-kabir', 'kabir', '${NOIDA}', '2026-10-05', 'morning', '${AT}')`,
  // Arjun moving his Delhi visit: the hold names no pincode of its own.
  `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount, amount_ex_gst,
     gst_percent, state, expires_at, created_at, updated_at, razorpay_order_id, pincode, moves_appointment_id) VALUES
     ('h-kabir', 'kabir', 'consultation', '2026-10-05', 'morning', 't-gurgaon', 0, 50000, 42373, 18, 'held', '${AT}',
      '${AT}', '${AT}', 'order_kabir', '${NOIDA}', NULL),
     ('h-move', 'arjun', 'service', '2026-10-06', 'morning', 't-gurgaon', 0, 0, 0, 18, 'held', '${AT}', '${AT}',
      '${AT}', NULL, NULL, 'v-delhi')`,
  `INSERT INTO payments (id, person_id, appointment_id, razorpay_order_id, razorpay_payment_id, amount, currency,
     status, created_at, updated_at) VALUES
     ('pay-visit', 'arjun', 'v-delhi', NULL, 'pay_1', 250000, 'INR', 'captured', '${AT}', '${AT}'),
     ('pay-hold', 'kabir', NULL, 'order_kabir', 'pay_2', 50000, 'INR', 'captured', '${AT}', '${AT}'),
     ('pay-client', 'neha', NULL, NULL, 'pay_3', 50000, 'INR', 'captured', '${AT}', '${AT}'),
     ('pay-nobody', NULL, NULL, NULL, 'pay_4', 50000, 'INR', 'captured', '${AT}', '${AT}')`,
  `INSERT INTO refunds (id, payment_id, razorpay_refund_id, amount, status, created_at, updated_at) VALUES
     ('refund-hold', 'pay-hold', 'rfnd_1', 50000, 'processed', '${AT}', '${AT}')`,
  `INSERT INTO checkins (id, appointment_id, technician_id, at, radius_m, passed, created_at) VALUES
     ('ci-noida', 'v-noida', 't-gurgaon', '${AT}', 150, 1, '${AT}')`,
  `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, created_at) VALUES
     ('ns-noida', 'ci-noida', 'v-noida', '${AT}', '${AT}', '${AT}')`,
  `INSERT INTO no_show_disputes (id, case_id, person_id, reason, created_at) VALUES
     ('nd-noida', 'ns-noida', 'rohit', 'I was home.', '${AT}')`,
  `INSERT INTO grievances (id, person_id, text, state, created_at) VALUES
     ('g-arjun', 'arjun', 'The technician came late.', 'open', '${AT}')`,
  `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, state) VALUES
     ('nc-meera', 'meera', '${AT}', '+919810000009', 'verifying')`,
  `INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES ('dr-zoya', 'zoya', '${AT}', 'requested')`,
  `INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('ARJUN1', 'arjun', '${AT}', '${AT}')`,
  `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, created_at, updated_at) VALUES
     ('ref-meera', 'ARJUN1', 'meera', '${AT}', 'waitlist', '${AT}', '${AT}')`,
];

beforeEach(async () => {
  await markDatabase();
  await env.DB.batch(ROWS.map((sql) => env.DB.prepare(sql)));
});

const citiesOf = async (kind: PlacedRecord, ids: readonly string[]) =>
  Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await cityOf(env.DB, kind, id)])));

describe("a client's city", () => {
  it("is their current address's; before one, their latest visit's, then where they booked, asked or waited", async () => {
    expect(await citiesOf("client", ["arjun", "rohit", "meera", "kabir"])).toEqual({
      arjun: "Gurgaon",
      rohit: "Noida",
      meera: "Delhi",
      kabir: "Noida",
    });
  });

  it("passes over an address in no city of ours, and is none where nothing names one", async () => {
    expect(await citiesOf("client", ["neha", "zoya", "nobody"])).toEqual({ neha: "Gurgaon", zoya: null, nobody: null });
  });
});

describe("a visit and what hangs off it", () => {
  it("is where the visit is, not where its client lives now", async () => {
    expect(await citiesOf("visit", ["v-delhi", "v-noida", "v-none"])).toEqual({
      "v-delhi": "Delhi",
      "v-noida": "Noida",
      "v-none": null,
    });
    expect(await cityOf(env.DB, "no_show", "ns-noida")).toBe("Noida");
    expect(await cityOf(env.DB, "dispute", "nd-noida")).toBe("Noida");
  });

  it("puts a hold at its own pincode, else at the visit it moves", async () => {
    expect(await citiesOf("hold", ["h-kabir", "h-move"])).toEqual({ "h-kabir": "Noida", "h-move": "Delhi" });
  });

  it("puts a payment at its visit, else the hold it paid for, else its client; a refund with its payment", async () => {
    expect(await citiesOf("payment", ["pay-visit", "pay-hold", "pay-client", "pay-nobody"])).toEqual({
      "pay-visit": "Delhi",
      "pay-hold": "Noida",
      "pay-client": "Gurgaon",
      "pay-nobody": null,
    });
    expect(await cityOf(env.DB, "refund", "refund-hold")).toBe("Noida");
  });
});

describe("a request", () => {
  it("is where its client is", async () => {
    expect(await cityOf(env.DB, "grievance", "g-arjun")).toBe("Gurgaon");
    expect(await cityOf(env.DB, "number_change", "nc-meera")).toBe("Delhi");
    expect(await cityOf(env.DB, "deletion_request", "dr-zoya")).toBeNull();
    expect(await cityOf(env.DB, "referral", "ref-meera")).toBe("Delhi");
  });

  it("is at its own pincode when it names one", async () => {
    expect(await cityOf(env.DB, "waitlist_entry", "w-meera")).toBe("Delhi");
    expect(await cityOf(env.DB, "consultation_request", "ask-kabir")).toBe("Noida");
  });
});

describe("a technician", () => {
  it("is in the city ops gave him, or in none", async () => {
    expect(await citiesOf("technician", ["t-gurgaon", "t-none"])).toEqual({ "t-gurgaon": "Gurgaon", "t-none": null });
  });
});

describe("a list kept within reach", () => {
  const clientsWithin = async (reached: PlacesReached) => {
    const { results } = await env.DB.prepare(
      `SELECT record.id FROM people record WHERE ${withinReach("client", "record", "?1")} ORDER BY record.id`,
    )
      .bind(reachBinding(reached))
      .all<{ id: string }>();
    return results.map((row) => row.id);
  };

  it("keeps the records in the cities reached, and one in no city only everywhere", async () => {
    expect(await clientsWithin({ kind: "cities", cities: new Set(["Gurgaon", "Delhi"]) })).toEqual([
      "arjun",
      "meera",
      "neha",
    ]);
    expect(await clientsWithin({ kind: "cities", cities: new Set() })).toEqual([]);
    expect(await clientsWithin({ kind: "everywhere" })).toEqual(["arjun", "kabir", "meera", "neha", "rohit", "zoya"]);
  });
});
