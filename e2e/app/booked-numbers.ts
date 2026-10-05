// Numbers that may log in to the client app with a consultation still to be confirmed, as Phase 1's booking form
// left them: the person, their consent to be contacted, and a lead for a weekday morning in Gurgaon with a day
// proposed. Home shows it as "Your consultation" (src/routes/client/me.ts). Each test used to make its own through
// POST /api/lead, which is gone (docs/open-points.md, item 107), and the site's booking form now holds a slot that
// FSM confirms within seconds, after which Home shows the visit instead.
//
// e2e/global-setup.ts writes the numbers into the local database once, before any test runs: wrangler writing to
// it while mm-api does would meet it on SQLite's lock. Each test then takes a number nobody else has, by making a
// directory named after it, which only one of the test workers can do. Every name and number is made up.

import { mkdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomMobile } from "../support.ts";
import { wrangler } from "./fitted.ts";
import { sqlRow } from "../../scripts/lib/sql-literal.ts";

/** Every test that takes one, with a retry each, and room to spare. */
const POOL_SIZE = 120;
const HANDOVER = "MM_E2E_BOOKED_NUMBERS";
const DAY = 24 * 60 * 60 * 1000;

interface Pool {
  /** Ten digits each, as the login's field takes them. */
  readonly mobiles: readonly string[];
  /** Where each test marks the number it took. */
  readonly taken: string;
}

export async function seedBookedNumbers(): Promise<void> {
  const now = new Date().toISOString();
  const proposed = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
  const mobiles = Array.from({ length: POOL_SIZE }, () => randomMobile());
  const sql = mobiles.flatMap((mobile) => {
    const person = crypto.randomUUID();
    return [
      `INSERT INTO people (id, created_at, mobile_e164, name, contactable)
         VALUES ${sqlRow(person, now, `+91${mobile}`, "Rohit Malhotra", 1)};`,
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
         VALUES ${sqlRow(crypto.randomUUID(), person, "contact", "booking-v1", 1, now)};`,
      `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent,
         proposed_visit_date, request_id)
         VALUES ${sqlRow(crypto.randomUUID(), person, now, "form", "Gurgaon", "weekday_am", "crown", proposed, "e2e")};`,
    ];
  });
  // Too long for a command line on Windows, so it goes in a file.
  const folder = await mkdtemp(join(tmpdir(), "mm-e2e-"));
  try {
    await writeFile(join(folder, "booked-numbers.sql"), sql.join("\n"));
    await wrangler("d1", "execute", "DB", "--local", "--file", join(folder, "booked-numbers.sql"));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }

  const taken = join(tmpdir(), `mm-e2e-booked-${crypto.randomUUID()}`);
  mkdirSync(taken);
  process.env[HANDOVER] = JSON.stringify({ mobiles, taken } satisfies Pool);
}

/** A number with a consultation to be confirmed, which no other test has taken. */
export function bookedNumber(): string {
  const handed = process.env[HANDOVER];
  if (handed === undefined) throw new Error("no booked numbers: e2e/global-setup.ts seeds them");
  const pool = JSON.parse(handed) as Pool;
  for (const mobile of pool.mobiles) {
    try {
      mkdirSync(join(pool.taken, mobile));
      return mobile;
    } catch {
      // Another test took this one.
    }
  }
  throw new Error(`all ${String(POOL_SIZE)} booked numbers are taken: raise POOL_SIZE in e2e/app/booked-numbers.ts`);
}
