// Two clients whose next visit the change tests move and cancel (boards C7 and C8), written into the local
// database as the FSM and payments mirrors would hold them: each has a paid service visit with a work order in
// (stub) FSM. One visit is five days out, free to change; the other starts in three hours, inside 24 hours.
// Every name and number is made up.
//
// e2e/global-setup.ts seeds them once, with the fitted client (e2e/app/fitted.ts), since wrangler writing to the
// local database while mm-api does would meet it on SQLite's lock.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomMobile } from "../support.ts";
import { E2E_TECHNICIANS, technicianFor } from "../technicians.ts";
import { row, wrangler } from "./fitted.ts";

export interface Changing {
  /** Ten digits, as the login's field takes it. */
  readonly mobile: string;
  readonly visitId: string;
  /** India's calendar date of the visit. */
  readonly date: string;
}

const HANDOVER = "MM_E2E_CHANGING";
const HOUR = 60 * 60 * 1000;

/** The clients the global setup seeded: one free to change, one inside 24 hours. */
export function changingClients(): { free: Changing; late: Changing } {
  const handed = process.env[HANDOVER];
  if (handed === undefined) throw new Error("no changing clients: e2e/global-setup.ts seeds them");
  return JSON.parse(handed) as { free: Changing; late: Changing };
}

export async function seedChanging(): Promise<void> {
  const now = new Date();
  const at = now.toISOString();
  const technician = E2E_TECHNICIANS.changing.id;
  const sql = technicianFor("changing", at);
  const client = (starts: Date): Changing => {
    const [person, visit, payment] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const mobile = randomMobile();
    const ends = new Date(starts.getTime() + 1.5 * HOUR);
    sql.push(
      `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ${row(person, at, `+91${mobile}`, "Rohit Malhotra")};`,
      `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, window_start, window_end,
         technician_id, status, fsm_status, service_city, service_pincode, fsm_modified_at, synced_at) VALUES
         ${row(visit, `e2e-${visit}`, `e2e-order-${visit}`, person, "service", starts.toISOString(), ends.toISOString(), technician, "scheduled", "Scheduled", "Gurgaon", "122018", at, at)};`,
      `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, method, status,
         captured_at, created_at, updated_at) VALUES
         ${row(payment, person, visit, `pay_${payment}`, 200000, "INR", "upi", "captured", at, at, at)};`,
    );
    const date = new Date(starts.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
    return { mobile, visitId: visit, date };
  };
  // Five days out at noon in India: its afternoon window, free to change until four days out.
  const fiveDays = new Date(now.getTime() + 330 * 60 * 1000 + 5 * 24 * HOUR).toISOString().slice(0, 10);
  const free = client(new Date(`${fiveDays}T06:30:00.000Z`));
  // Three hours from now, whatever the time of day: always ahead, and always inside 24 hours of its window.
  const late = client(new Date(Math.ceil((now.getTime() + 3 * HOUR) / 60_000) * 60_000));

  const folder = await mkdtemp(join(tmpdir(), "mm-e2e-"));
  try {
    await writeFile(join(folder, "changing.sql"), sql.join("\n"));
    await wrangler("d1", "execute", "DB", "--local", "--file", join(folder, "changing.sql"));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
  process.env[HANDOVER] = JSON.stringify({ free, late });
}
