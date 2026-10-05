// A fitted client with an address saved, who books in the booking tests (e2e/app/booking.e2e.ts). No slot is held
// for a client without one (ADR 0079), and the fitted client of e2e/app/fitted.ts has none, so that Home asks for
// it. Written into the local database as the FSM mirror would hold them: a first fit done 60 days ago, with the
// fitted client's technician, so a service visit is what they book, and both photograph consents given. Every name
// and number is made up.
//
// e2e/global-setup.ts seeds the client once, after the fitted client, whose technician this one's fit names.

import { indiaDate } from "../../src/lib/india-time.ts";
import { randomMobile } from "../support.ts";
import { E2E_TECHNICIANS } from "../technicians.ts";
import { wrangler } from "./fitted.ts";
import { sqlRow } from "../../scripts/lib/sql-literal.ts";

export interface Booker {
  /** Ten digits, as the login's field takes it. */
  readonly mobile: string;
}

const HANDOVER = "MM_E2E_BOOKER";
const DAY = 24 * 60 * 60 * 1000;

/** The client the global setup seeded. */
export function bookerClient(): Booker {
  const handed = process.env[HANDOVER];
  if (handed === undefined) throw new Error("no booking client: e2e/global-setup.ts seeds one");
  return JSON.parse(handed) as Booker;
}

export async function seedBooker(): Promise<void> {
  const now = new Date().toISOString();
  const [person, fit] = [crypto.randomUUID(), crypto.randomUUID()];
  const mobile = randomMobile();
  const fitted = indiaDate(new Date(Date.now() - 60 * DAY));
  const sql = [
    `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ${sqlRow(person, now, `+91${mobile}`, "Rohit Malhotra")};`,
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
       fsm_status, service_city, service_pincode, fsm_modified_at, synced_at) VALUES
       ${sqlRow(fit, `e2e-${fit}`, person, "first_fit", `${fitted}T03:30:00.000Z`, `${fitted}T06:30:00.000Z`, E2E_TECHNICIANS.fitted.id, "completed", "Completed", "Gurgaon", "122018", now, now)};`,
    `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode) VALUES
       ${sqlRow(crypto.randomUUID(), person, now, "House 4417, Tower C", "Sector 65", "Gurgaon", "122018")};`,
    // Both photograph consents already given in Profile, so the pay step asks for neither (ADR 0080) and is as
    // boards C4 and C5 draw it. A test that needs them undecided says so in the profile it answers.
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at) VALUES
       ${sqlRow(crypto.randomUUID(), person, "photos_own_record", "photos-own-record-v1", 1, now)},
       ${sqlRow(crypto.randomUUID(), person, "photos_referral_cards", "photos-referral-cards-v2", 1, now)};`,
  ];
  await wrangler("d1", "execute", "DB", "--local", "--command", sql.join("\n"));
  process.env[HANDOVER] = JSON.stringify({ mobile } satisfies Booker);
}
