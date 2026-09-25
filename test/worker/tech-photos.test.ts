// A technician's photographs, attached to FSM's job sheet (src/domain/tech-photos.ts).
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { attachPhotosToFsm } from "../../src/domain/tech-photos.ts";
import { createStubFsm, EMPTY_FSM, type StubFsm } from "../../src/providers/fsm.ts";
import { markDatabase, NOW } from "./helpers.ts";
import { syntheticJpeg } from "./tryon-fixtures.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222221";
const JOB_IN_FSM = { id: JOB, fsmId: "ap-1" };

let fsm: StubFsm;

beforeEach(async () => {
  await markDatabase();
  fsm = createStubFsm(EMPTY_FSM);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
    ).bind(PERSON, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
         fsm_modified_at, synced_at)
       VALUES (?1, 'ap-1', ?2, 'service', 'in_progress', 'In Progress', '2026-09-21T04:30:00.000Z',
         '2026-09-21T06:00:00.000Z', ?3, ?3)`,
    ).bind(JOB, PERSON, NOW.toISOString()),
    env.DB.prepare(
      "INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES ('set-before', ?1, 'before', ?2)",
    ).bind(JOB, NOW.toISOString()),
  ]);
});

/** One photograph of the before set, in the bucket and in D1, not yet in FSM. */
async function photo(angle: string, bytes: Uint8Array): Promise<void> {
  const key = `visits/${JOB}/before-${angle}.jpg`;
  await env.CLIENT_PHOTOS.put(key, bytes);
  await env.DB.prepare(
    `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, taken_at, created_at)
     VALUES (?1, 'set-before', ?2, ?3, 'image/jpeg', ?4, ?5, ?5)`,
  )
    .bind(crypto.randomUUID(), angle, key, bytes.byteLength, NOW.toISOString())
    .run();
}

const attachmentOf = (angle: string) =>
  env.DB.prepare("SELECT fsm_attachment_id FROM photos WHERE angle = ?1")
    .bind(angle)
    .first<string>("fsm_attachment_id");

describe("attaching the photographs to FSM", () => {
  it("finds a file FSM took whose answer never came, by its name and size, rather than attaching it twice", async () => {
    await photo("front", syntheticJpeg(800, 800, "front"));
    fsm.loseAnswer("attachToAppointment");
    await expect(attachPhotosToFsm(env.DB, env.CLIENT_PHOTOS, fsm, JOB_IN_FSM, "before")).rejects.toThrow();

    expect(await attachPhotosToFsm(env.DB, env.CLIENT_PHOTOS, fsm, JOB_IN_FSM, "before")).toBe(1);
    expect(fsm.made.attached).toHaveLength(1);
    const [held] = await fsm.attachments("ap-1");
    expect(await attachmentOf("front")).toBe(held?.id);
  });

  it("attaches a photograph taken again at the same angle, whose bytes differ from the one FSM holds", async () => {
    await photo("front", syntheticJpeg(800, 800, "first take"));
    await attachPhotosToFsm(env.DB, env.CLIENT_PHOTOS, fsm, JOB_IN_FSM, "before");

    const retake = syntheticJpeg(1200, 900, "second take");
    await env.DB.prepare("UPDATE photos SET fsm_attachment_id = NULL, bytes = ?1").bind(retake.byteLength).run();
    await env.CLIENT_PHOTOS.put(`visits/${JOB}/before-front.jpg`, retake);
    await attachPhotosToFsm(env.DB, env.CLIENT_PHOTOS, fsm, JOB_IN_FSM, "before");

    expect(fsm.made.attached.map((file) => file.bytes)).toEqual([expect.any(Number), retake.byteLength]);
  });
});
