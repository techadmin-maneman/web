// A client who made a try-on on the site before their consultation: the gate
// claimed it with their number, so it is theirs in the app (ADR 0082). Written
// straight into the local database and the buckets the local mm-api reads. The
// client has a consultation booked from the site and no visit done, so their
// Photos tab has the try-on and no visit photographs. They agreed to the photo
// notice that keeps a client's try-on, and the site sent the photograph's small
// copy with it, so the try-on is kept (ADR 0084). Every name and number is made
// up, and the photograph, its copy and the look are plain blocks.
//
// e2e/global-setup.ts seeds the client once, before any test runs, as it does
// the fitted client (e2e/app/fitted.ts). The tests only read it.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { randomMobile } from "../support.ts";
import { row, wrangler } from "./fitted.ts";

export interface TryOnClient {
  /** Ten digits, as the login's field takes it. */
  readonly mobile: string;
  /** When the look was asked for, and when it expires, as the API reads them. */
  readonly createdAt: string;
  readonly expiresAt: string;
}

const HANDOVER = "MM_E2E_TRY_ON";
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** The client the global setup seeded. */
export function tryOnClient(): TryOnClient {
  const handed = process.env[HANDOVER];
  if (handed === undefined) throw new Error("no try-on client: e2e/global-setup.ts seeds one");
  return JSON.parse(handed) as TryOnClient;
}

/** A blank JPEG of one ink, 600 × 800, written where `r2 bulk put` can read it. */
async function block(folder: string, name: string, ink: string): Promise<string> {
  const file = join(folder, name);
  await writeFile(
    file,
    await sharp({ create: { width: 600, height: 800, channels: 3, background: ink } })
      .jpeg()
      .toBuffer(),
  );
  return file;
}

export async function seedTryOn(): Promise<void> {
  const mobile = randomMobile();
  const now = new Date();
  const at = now.toISOString();
  const [person, booking, tryOnLead, job] = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  const createdAt = new Date(now.getTime() - 2 * MINUTE).toISOString();
  // Staging keeps a look three days (RESULT_RETENTION_DAYS); production fourteen.
  const expiresAt = new Date(now.getTime() + 3 * DAY).toISOString();
  const consultationDay = new Date(now.getTime() + 330 * MINUTE + 3 * DAY).toISOString().slice(0, 10);
  const uploadKey = `uploads/${job}`;
  const copyKey = `tryons/${job}/before.jpg`;
  const resultKey = `results/${job}.jpg`;

  const sql = [
    `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ${row(person, at, `+91${mobile}`, "Arjun Mehta")};`,
    // The consultation booked from the site, which lets the number log in; and the lead the gate made.
    `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, proposed_visit_date,
       sync_state, request_id) VALUES
       ${row(booking, person, at, "form", "Gurgaon", "weekday_pm", "receding", consultationDay, "synced", "e2e")},
       ${row(tryOnLead, person, createdAt, "tryon", null, null, "receding", null, "synced", "e2e")};`,
    // Claimed with the number proved by its WhatsApp code, as every claim is.
    `INSERT INTO tryon_jobs (id, created_at, upload_key, uploaded_at, stage, preset, hair_color, endpoint, state,
       result_key, expires_at, person_id, lead_id, claimed_at, photo_consent_version, photo_consent_at, ip_hash,
       request_id, copy_key, number_proved_at) VALUES
       ${row(job, createdAt, uploadKey, createdAt, "receding", "medium-natural-short", "black", "pro", "ready", resultKey, expiresAt, person, tryOnLead, createdAt, "photo-v2", createdAt, "e2e", "e2e", copyKey, createdAt)};`,
  ];

  const folder = await mkdtemp(join(tmpdir(), "mm-e2e-"));
  try {
    const images = [
      { bucket: "mm-local-tryon-uploads", key: uploadKey, file: await block(folder, "photo.jpg", "#131c2e") },
      { bucket: "mm-local-client-photos", key: copyKey, file: await block(folder, "copy.jpg", "#131c2e") },
      { bucket: "mm-local-tryon-results", key: resultKey, file: await block(folder, "look.jpg", "#1a2740") },
    ];
    for (const image of images) {
      const list = join(folder, `${image.bucket}.json`);
      await writeFile(list, JSON.stringify([{ key: image.key, file: image.file }]));
      await wrangler("r2", "bulk", "put", image.bucket, "--local", "--filename", list, "--ct", "image/jpeg");
    }
    await writeFile(join(folder, "try-on.sql"), sql.join("\n"));
    await wrangler("d1", "execute", "DB", "--local", "--file", join(folder, "try-on.sql"));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }

  const client: TryOnClient = { mobile, createdAt, expiresAt };
  process.env[HANDOVER] = JSON.stringify(client);
}
