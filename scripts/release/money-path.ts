// Every night, staging's money path as a client walks it: a service visit held in the first free window, its payment
// started, which has Razorpay (test mode) make an order, and the hold let go. Nothing is paid, so nothing is captured
// or refunded, and the window is free again at once.
//
//   npm run watch:money-path
//
// The client is one record kept for this, made the first time and found every time after: "Staging test" by name, so
// nothing is ever sent to its number (isStagingTestRecord, src/policy/staging-test-records.ts), fitted, with a Gurgaon
// address we serve. Its session is written for the run and taken out after it, as e2e/tech-staging/seed.ts writes the
// technician's: a code cannot be read from a desktop. The token is never printed.
//
// Environment:
//   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET   Access service token (staging)
//   CLOUDFLARE_API_TOKEN                            for wrangler, which writes the client and its session

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { sqlLiteral, sqlRow } from "../lib/sql-literal.ts";
import { toBase64Url } from "../../src/lib/base64url.ts";
import { sha256Hex } from "../../src/lib/hash.ts";

const run = promisify(execFile);
const WRANGLER = resolve("node_modules/wrangler/bin/wrangler.js");
const DATABASE = "maneman-staging";
const APP = "https://app-staging.maneman.in";
const DAY_MS = 24 * 60 * 60 * 1000;

/** The client kept for this run, and what makes them one who may book a service visit. */
const CLIENT = {
  person: "5a1e0000-0000-4000-8000-00000000c11e",
  address: "5a1e0000-0000-4000-8000-0000000add7f",
  firstFit: "5a1e0000-0000-4000-8000-0000000f1757",
  name: "Staging test money path",
  mobile: "+919000047170",
} as const;

async function execute(statements: readonly string[]): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), "mm-money-path-"));
  try {
    const file = join(folder, "statements.sql");
    await writeFile(file, statements.join("\n"));
    await run(process.execPath, [WRANGLER, "d1", "execute", DATABASE, "--env", "staging", "--remote", "--file", file]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** The client, made if this is the first run, and a session for this one. Its token, which is never printed. */
async function signedIn(): Promise<{ token: string; sessionId: string }> {
  const now = new Date().toISOString();
  const fitted = new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10);
  // The cookie's token, and the SHA-256 the sessions table holds of it (src/domain/sign-in/sessions.ts).
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const sessionId = await sha256Hex(token);
  await execute([
    `INSERT OR IGNORE INTO people (id, created_at, mobile_e164, name, contactable, test_record)
       VALUES ${sqlRow(CLIENT.person, now, CLIENT.mobile, CLIENT.name, 1, 1)};`,
    `INSERT OR IGNORE INTO addresses (id, person_id, created_at, line1, locality, city, pincode, lat, lng, geocoded_at)
       VALUES ${sqlRow(CLIENT.address, CLIENT.person, now, "Tower C, 14th floor", "Sector 65", "Gurgaon", "122018", 28.398, 77.07, now)};`,
    `INSERT OR IGNORE INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
       service_city, service_pincode, fsm_modified_at, synced_at)
       VALUES ${sqlRow(CLIENT.firstFit, `money-path-${CLIENT.firstFit}`, CLIENT.person, "first_fit", `${fitted}T04:30:00.000Z`, `${fitted}T07:30:00.000Z`, "completed", "Completed", "Gurgaon", "122018", now, now)};`,
    `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at, device_label)
       VALUES ${sqlRow(sessionId, "client", CLIENT.person, now, now, new Date(Date.now() + DAY_MS).toISOString(), "The nightly money-path run")};`,
  ]);
  return { token, sessionId };
}

/** A call as the client's app makes it, through Access. */
function caller(token: string) {
  const headers = {
    "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID ?? "",
    "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "",
    Cookie: `__Host-mm_app=${token}`,
    Origin: APP,
  };
  return async (method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> => {
    const answer = await fetch(`${APP}${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await answer.text();
    return { status: answer.status, body: text === "" ? null : (JSON.parse(text) as unknown) };
  };
}

interface Me {
  booking: { types: string[]; services: { type: string; tier: string }[] };
}
interface Availability {
  days: { date: string; windows: { window: string; open: boolean }[] }[];
}

/** Each leg, said as it passes; the first that fails ends the run with its status and the API's error code. */
function expectStatus(leg: string, status: number, wanted: number, body: unknown): void {
  if (status === wanted) {
    console.log(`ok   ${leg}`);
    return;
  }
  const code = (body as { error?: { code?: string } } | null)?.error?.code ?? "no error code";
  throw new Error(`${leg}: answered ${String(status)} (${code}), not ${String(wanted)}`);
}

async function walk(token: string): Promise<void> {
  const call = caller(token);
  const me = await call("GET", "/api/me");
  expectStatus("the client's Home", me.status, 200, me.body);
  const service = (me.body as Me).booking.services.find((each) => each.type === "service");
  if (service === undefined) throw new Error("the client's Home offers no service visit to book");

  const asked = await call("GET", `/api/availability?type=service&tier=${service.tier}`);
  expectStatus("the days open", asked.status, 200, asked.body);
  const open = (asked.body as Availability).days.flatMap((day) =>
    day.windows.filter((each) => each.open).map((each) => ({ date: day.date, window: each.window })),
  )[0];
  if (open === undefined) throw new Error("no window is open in the days the app offers");

  const held = await call("POST", "/api/holds", { type: "service", tier: service.tier, ...open });
  expectStatus(`a hold on ${open.date}, ${open.window}`, held.status, 201, held.body);
  const holdId = (held.body as { id: string }).id;
  try {
    const started = await call("POST", "/api/bookings", { hold_id: holdId });
    expectStatus("the payment started", started.status, 201, started.body);
    const checkout = (started.body as { checkout: { order_id: string } | null }).checkout;
    if (checkout?.order_id.startsWith("order_") !== true) {
      throw new Error("the payment started without a Razorpay order");
    }
    console.log("ok   a Razorpay order made");
  } finally {
    const released = await call("DELETE", `/api/holds/${holdId}`);
    expectStatus("the hold let go", released.status, 204, released.body);
  }
}

const { token, sessionId } = await signedIn();
try {
  await walk(token);
  console.log("the money path walks");
} finally {
  await execute([`DELETE FROM sessions WHERE id = ${sqlLiteral(sessionId)};`]);
}
