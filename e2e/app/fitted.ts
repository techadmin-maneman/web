// A fitted client, as the FSM and payments mirrors would hold one
// (docs/decisions/0032-fsm-mirror.md, 0044-payments-mirror.md), written
// straight into the local database and photograph bucket that the local
// mm-api reads: locally FSM is a stub with nothing in it. Every name and
// number is made up, and the photographs are plain blocks, never a person.
//
// The client has a service visit booked in three days; a service visit done
// 20 days ago, paid by UPI, partly refunded, and invoiced by (stub) Books; and
// a first fit done 60 days ago, paid by card. The service visit has front and
// hairline photographs after it, and the first fit a front.
//
// e2e/global-setup.ts seeds the client once, before any test runs: wrangler
// writing to the local database while mm-api does would meet it on SQLite's
// lock. The tests only read it.

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { randomMobile } from "../support.ts";

const run = promisify(execFile);
const WRANGLER = resolve("node_modules/wrangler/bin/wrangler.js");
const BUCKET = "mm-local-client-photos";
const DAY = 24 * 60 * 60 * 1000;

export interface FittedVisit {
  readonly id: string;
  /** India's calendar date, YYYY-MM-DD. */
  readonly date: string;
}

export interface Fitted {
  /** Ten digits, as the login's field takes it. */
  readonly mobile: string;
  readonly next: FittedVisit;
  readonly service: FittedVisit;
  readonly firstFit: FittedVisit;
  /** The service visit's payment reference. */
  readonly reference: string;
}

const wrangler = (...args: string[]) => run(process.execPath, [WRANGLER, ...args], { cwd: resolve(".") });

/** Where the global setup leaves the client for the tests. */
const HANDOVER = "MM_E2E_FITTED";

/** India's date `days` from today, and the afternoon window's start and end on it (12 to 1:30 pm). */
function day(days: number): { date: string; start: string; end: string } {
  const date = new Date(Date.now() + 330 * 60 * 1000 + days * DAY).toISOString().slice(0, 10);
  return { date, start: `${date}T06:30:00.000Z`, end: `${date}T08:00:00.000Z` };
}

const quote = (value: string | number | null) =>
  value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
const row = (...values: (string | number | null)[]) => `(${values.map(quote).join(", ")})`;

/** The client the global setup seeded. */
export function fittedClient(): Fitted {
  const handed = process.env[HANDOVER];
  if (handed === undefined) throw new Error("no fitted client: e2e/global-setup.ts seeds one");
  return JSON.parse(handed) as Fitted;
}

export async function seedFitted(): Promise<void> {
  const mobile = randomMobile();
  const now = new Date().toISOString();
  const id = () => crypto.randomUUID();
  const [person, technician] = [id(), id()];
  const [next, service, firstFit] = [day(3), day(-20), day(-60)];
  const visits = { next: id(), service: id(), firstFit: id() };
  const [servicePaid, firstFitPaid] = [id(), id()];
  const reference = `MM-2099-${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;

  const appointment = (
    appointmentId: string,
    type: string,
    when: ReturnType<typeof day>,
    status: string,
    invoice: string | null,
  ) =>
    row(
      appointmentId,
      `e2e-${appointmentId}`,
      person,
      type,
      when.start,
      when.end,
      technician,
      status,
      status === "completed" ? "Completed" : "Scheduled",
      "Gurgaon",
      "122018",
      invoice,
      now,
      now,
    );

  const sql = [
    `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ${row(person, now, `+91${mobile}`, "Rohit Malhotra")};`,
    `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at)
       VALUES ${row(technician, `e2e-${technician}`, "Imran Qureshi", "IQ", 1, now)};`,
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status,
       fsm_status, service_city, service_pincode, fsm_invoice_id, fsm_modified_at, synced_at) VALUES
       ${appointment(visits.next, "service", next, "scheduled", null)},
       ${appointment(visits.service, "service", service, "completed", `stub-e2e-${visits.service}`)},
       ${appointment(visits.firstFit, "first_fit", firstFit, "completed", null)};`,
    `INSERT INTO visits (id, appointment_id, started_at, ended_at, duration_minutes, outcome, updated_at) VALUES
       ${row(id(), visits.service, service.start, service.end, 85, "done", now)},
       ${row(id(), visits.firstFit, firstFit.start, firstFit.end, 150, "done", now)};`,
    `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
       status, captured_at, created_at, updated_at) VALUES
       ${row(servicePaid, reference, person, visits.service, `pay_${servicePaid}`, 200000, "INR", "upi", "captured", service.end, service.end, now)},
       ${row(firstFitPaid, null, person, visits.firstFit, `pay_${firstFitPaid}`, 3000000, "INR", "card", "captured", firstFit.end, firstFit.end, now)};`,
    `INSERT INTO refunds (id, payment_id, razorpay_refund_id, amount, status, speed, created_at, updated_at)
       VALUES ${row(id(), servicePaid, `rfnd_${servicePaid}`, 100000, "created", "normal", day(-18).end, now)};`,
  ];

  const taken = [
    { visit: visits.service, when: service, angle: "front", ink: "#16233a" },
    { visit: visits.service, when: service, angle: "hair", ink: "#1a2740" },
    { visit: visits.firstFit, when: firstFit, angle: "front", ink: "#131c2e" },
  ];
  const sets = new Map([visits.service, visits.firstFit].map((visit) => [visit, id()]));
  sql.push(
    `INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES
       ${[...sets].map(([visit, set]) => row(set, visit, "after", now)).join(", ")};`,
  );

  const folder = await mkdtemp(join(tmpdir(), "mm-e2e-"));
  try {
    const uploads = await Promise.all(
      taken.map(async (photo, index) => {
        const file = join(folder, `${String(index)}.jpg`);
        const bytes = await sharp({ create: { width: 600, height: 800, channels: 3, background: photo.ink } })
          .jpeg()
          .toBuffer();
        await writeFile(file, bytes);
        const key = `e2e/${person}/${photo.visit}/after-${photo.angle}.jpg`;
        sql.push(
          `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, width, height, taken_at, created_at)
             VALUES ${row(id(), sets.get(photo.visit) ?? "", photo.angle, key, "image/jpeg", bytes.length, 600, 800, photo.when.end, now)};`,
        );
        return { key, file };
      }),
    );
    await writeFile(join(folder, "photos.json"), JSON.stringify(uploads));
    await wrangler(
      "r2",
      "bulk",
      "put",
      BUCKET,
      "--local",
      "--filename",
      join(folder, "photos.json"),
      "--ct",
      "image/jpeg",
    );
    await writeFile(join(folder, "seed.sql"), sql.join("\n"));
    await wrangler("d1", "execute", "DB", "--local", "--file", join(folder, "seed.sql"));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }

  const client: Fitted = {
    mobile,
    next: { id: visits.next, date: next.date },
    service: { id: visits.service, date: service.date },
    firstFit: { id: visits.firstFit, date: firstFit.date },
    reference,
  };
  process.env[HANDOVER] = JSON.stringify(client);
}
