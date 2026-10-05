// Three clients the next visit's tests read (e2e/app/next-visit.e2e.ts; docs/decisions/0086-the-next-visit-is-offered.md),
// written into the local database as the FSM mirror would hold them, each with an address saved and nothing booked,
// so no slot is ever held for them here. Every name and number is made up.
//
//   due:          fitted, their last service done 25 days ago in the morning, so the next falls due in five days;
//   replacement:  fitted, their last service done 25 days ago in the evening, and their piece falls due in three
//                 days, before the next service would, so a replacement is offered on that day, in no window;
//   firstFit:     their consultation done two days ago in the afternoon, so the first fit is offered then too.
//
// e2e/global-setup.ts seeds them once, after the fitted client, whose technician their visits name.

import { indiaDate } from "../../src/lib/india-time.ts";
import { randomMobile } from "../support.ts";
import { E2E_TECHNICIANS } from "../technicians.ts";
import { wrangler } from "./fitted.ts";
import { sqlRow } from "../../scripts/lib/sql-literal.ts";

export interface NextVisitClient {
  /** Ten digits, as the login's field takes it. */
  readonly mobile: string;
  /** India's day the app offers the visit on. */
  readonly date: string;
}

export interface NextVisitClients {
  readonly due: NextVisitClient;
  readonly replacement: NextVisitClient;
  /** Offered from tomorrow, which firstFitDay reads when asked: a run can cross India's midnight after the seed. */
  readonly firstFit: Pick<NextVisitClient, "mobile">;
}

const HANDOVER = "MM_E2E_NEXT_VISIT";
const DAY = 24 * 60 * 60 * 1000;

/** India's calendar day `days` from today. */
const indiaDay = (days: number) => indiaDate(new Date(Date.now() + days * DAY));

/** India's day the app offers the first fit on: tomorrow, as of the moment it is asked. */
export const firstFitDay = (): string => indiaDay(1);

/** The clients the global setup seeded. */
export function nextVisitClients(): NextVisitClients {
  const handed = process.env[HANDOVER];
  if (handed === undefined) throw new Error("no next-visit clients: e2e/global-setup.ts seeds them");
  return JSON.parse(handed) as NextVisitClients;
}

export async function seedNextVisit(): Promise<void> {
  const now = new Date().toISOString();
  const technician = E2E_TECHNICIANS.fitted.id;
  const sql: string[] = [];

  /** A client with an address saved, both photograph consents given, and one visit done at `start` (UTC). */
  const client = (type: string, start: string, end: string): { person: string; mobile: string } => {
    const [person, visit] = [crypto.randomUUID(), crypto.randomUUID()];
    const mobile = randomMobile();
    sql.push(
      `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ${sqlRow(person, now, `+91${mobile}`, "Rohit Malhotra")};`,
      `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
         fsm_status, service_city, service_pincode, fsm_modified_at, synced_at) VALUES
         ${sqlRow(visit, `e2e-${visit}`, person, type, start, end, technician, "completed", "Completed", "Gurgaon", "122018", now, now)};`,
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode) VALUES
         ${sqlRow(crypto.randomUUID(), person, now, "House 4417, Tower C", "Sector 65", "Gurgaon", "122018")};`,
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at) VALUES
         ${sqlRow(crypto.randomUUID(), person, "photos_own_record", "photos-own-record-v1", 1, now)},
         ${sqlRow(crypto.randomUUID(), person, "photos_referral_cards", "photos-referral-cards-v2", 1, now)};`,
    );
    return { person, mobile };
  };

  const done = indiaDay(-25);
  // 10 am in India, a morning; due 30 days on.
  const due = client("service", `${done}T04:30:00.000Z`, `${done}T06:00:00.000Z`);
  // 5 pm in India, an evening, which a replacement cannot start in; the piece falls due in three days.
  const replacement = client("service", `${done}T11:30:00.000Z`, `${done}T13:00:00.000Z`);
  sql.push(
    `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, fitted_at, replacement_due_at, synced_at) VALUES
       ${sqlRow(crypto.randomUUID(), `e2e-piece-${replacement.person}`, replacement.person, "MM-STD-4417-D", "Mono", indiaDay(-177), indiaDay(3), now)};`,
  );
  // A consultation done two days ago at 1:30 pm in India, an afternoon.
  const consulted = indiaDay(-2);
  const firstFit = client("consultation", `${consulted}T08:00:00.000Z`, `${consulted}T09:00:00.000Z`);
  // A first fit is sold only as a hair system set up in the console, so the local database offers one.
  sql.push(
    `INSERT OR IGNORE INTO services (kind, tier, name, minutes, sort, updated_by, updated_at) VALUES
       ${sqlRow("first_fit", "essential", "Mane Man Essential", 180, 1, "e2e", now)};`,
    `INSERT OR IGNORE INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES
       ${sqlRow("first_fit", "essential", 2_500_000, 0, "2026-01-01")};`,
  );

  await wrangler("d1", "execute", "DB", "--local", "--command", sql.join("\n"));
  process.env[HANDOVER] = JSON.stringify({
    due: { mobile: due.mobile, date: indiaDay(5) },
    replacement: { mobile: replacement.mobile, date: indiaDay(3) },
    firstFit: { mobile: firstFit.mobile },
  } satisfies NextVisitClients);
}
