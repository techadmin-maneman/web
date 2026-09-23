import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { exportVisitPhotos, photoSlot } from "../../src/domain/visit-photos.ts";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM, type FsmAppointment, type FsmAttachment } from "../../src/providers/fsm.ts";
import { handleFsmSyncBatch } from "../../src/queues/fsm-sync.ts";
import { NOW, fakeDependencies } from "./helpers.ts";
import { syntheticJpeg, syntheticPng } from "./tryon-fixtures.ts";

const APPOINTMENT_ID = "11111111-1111-4111-8111-111111111111";

async function closedAppointment(id = APPOINTMENT_ID, fsmId = "ap-1") {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, type, status, fsm_status, fsm_modified_at, synced_at)
     VALUES (?1, ?2, 'service', 'completed', 'Completed', ?3, ?3)`,
  )
    .bind(id, fsmId, NOW.toISOString())
    .run();
}

const attachment = (id: string, name: string, createdAt = "2026-09-24T10:00:00+05:30"): FsmAttachment => ({
  id,
  fileId: `file-${id}`,
  name,
  size: 100,
  createdAt,
});

function fsmWith(attachments: FsmAttachment[], files: Record<string, Uint8Array>) {
  return createStubFsm({
    ...EMPTY_FSM,
    attachments: { "ap-1": attachments },
    files: Object.fromEntries(
      Object.entries(files).map(([id, bytes]) => [`file-${id}`, { bytes, contentType: "image/jpeg" }]),
    ),
  });
}

const stored = () =>
  env.DB.prepare(
    `SELECT s.phase, p.angle, p.content_type, p.width, p.height, p.fsm_attachment_id, p.r2_key, p.taken_at
     FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id ORDER BY s.phase, p.angle`,
  ).all();

describe("a photograph's phase and angle, from its file name", () => {
  it.each([
    ["before-front.jpg", { phase: "before", angle: "front" }],
    ["After_Hair.JPEG", { phase: "after", angle: "hair" }],
    ["before top.png", { phase: "before", angle: "top" }],
  ])("reads %s", (name, slot) => {
    expect(photoSlot(name)).toEqual(slot);
  });

  it.each(["IMG_2041.jpg", "before-back.jpg", "before-front", "notes.pdf"])("reads nothing from %s", (name) => {
    expect(photoSlot(name)).toBeNull();
  });
});

describe("exporting a visit's photographs", () => {
  it("copies each named photograph into the bucket, with its size, and leaves other files alone", async () => {
    await closedAppointment();
    const fsm = fsmWith(
      [attachment("a1", "before-front.jpg"), attachment("a2", "after-hair.png"), attachment("a3", "invoice.pdf")],
      { a1: syntheticJpeg(1200, 1600), a2: syntheticPng(800, 600) },
    );
    const result = await exportVisitPhotos(env.DB, env.CLIENT_PHOTOS, fsm, { id: APPOINTMENT_ID, fsmId: "ap-1" }, NOW);
    expect(result).toEqual({ exported: 2, unreadable: 0 });

    const { results } = await stored();
    expect(results).toEqual([
      expect.objectContaining({ phase: "after", angle: "hair", content_type: "image/png", width: 800, height: 600 }),
      expect.objectContaining({
        phase: "before",
        angle: "front",
        content_type: "image/jpeg",
        width: 1200,
        height: 1600,
      }),
    ]);
    const key = (results[1] as { r2_key: string }).r2_key;
    expect(key).toBe(`visits/${APPOINTMENT_ID}/before-front-a1.jpg`);
    const object = await env.CLIENT_PHOTOS.get(key);
    expect(object?.httpMetadata?.contentType).toBe("image/jpeg");
  });

  it("does not copy a photograph twice", async () => {
    await closedAppointment();
    const fsm = fsmWith([attachment("a1", "before-front.jpg")], { a1: syntheticJpeg(10, 10) });
    await exportVisitPhotos(env.DB, env.CLIENT_PHOTOS, fsm, { id: APPOINTMENT_ID, fsmId: "ap-1" }, NOW);
    const again = await exportVisitPhotos(env.DB, env.CLIENT_PHOTOS, fsm, { id: APPOINTMENT_ID, fsmId: "ap-1" }, NOW);
    expect(again).toEqual({ exported: 0, unreadable: 0 });
  });

  it("keeps the newest take of an angle, and never goes back to an earlier one", async () => {
    await closedAppointment();
    const takes = [
      attachment("old", "before-front.jpg", "2026-09-24T10:00:00+05:30"),
      attachment("new", "before-front.jpg", "2026-09-24T10:05:00+05:30"),
    ];
    const fsm = fsmWith(takes, { old: syntheticJpeg(10, 10), new: syntheticJpeg(20, 20) });
    await exportVisitPhotos(env.DB, env.CLIENT_PHOTOS, fsm, { id: APPOINTMENT_ID, fsmId: "ap-1" }, NOW);
    await exportVisitPhotos(env.DB, env.CLIENT_PHOTOS, fsm, { id: APPOINTMENT_ID, fsmId: "ap-1" }, NOW);

    const { results } = await stored();
    expect(results).toEqual([expect.objectContaining({ fsm_attachment_id: "new", width: 20 })]);
    // The earlier take stays in the bucket: a photograph is deleted only on purpose.
    expect(await env.CLIENT_PHOTOS.head(`visits/${APPOINTMENT_ID}/before-front-old.jpg`)).not.toBeNull();
  });

  it("counts a named file that is not a JPEG or PNG, and stores nothing for it", async () => {
    await closedAppointment();
    const fsm = fsmWith([attachment("a1", "before-front.jpg")], { a1: new TextEncoder().encode("not an image") });
    const result = await exportVisitPhotos(env.DB, env.CLIENT_PHOTOS, fsm, { id: APPOINTMENT_ID, fsmId: "ap-1" }, NOW);
    expect(result).toEqual({ exported: 0, unreadable: 1 });
    expect((await stored()).results).toEqual([]);
  });
});

describe("the fsm-sync queue, with photographs", () => {
  it("exports a closed appointment's photographs after syncing it", async () => {
    const closed: FsmAppointment = {
      id: "ap-1",
      name: "AP-1",
      status: "Completed",
      workOrderId: null,
      contactId: null,
      scheduledStart: "2026-09-24T10:00:00+05:30",
      scheduledEnd: "2026-09-24T11:30:00+05:30",
      actualStart: null,
      actualEnd: null,
      technicianIds: [],
      serviceIds: [],
      serviceCity: null,
      servicePincode: null,
      modifiedAt: "2026-09-24T11:30:00+05:30",
    };
    const fsm = createStubFsm({
      ...EMPTY_FSM,
      appointments: [closed],
      attachments: { "ap-1": [attachment("a1", "after-front.jpg")] },
      files: { "file-a1": { bytes: syntheticJpeg(10, 10), contentType: "image/jpeg" } },
    });
    const message = { id: "m", body: { fsm_id: "ap-1", request_id: "r" }, attempts: 1, ack: vi.fn(), retry: vi.fn() };
    await handleFsmSyncBatch(
      { messages: [message] } as unknown as MessageBatch,
      env,
      fakeDependencies({ fsm }),
      createLogger(),
    );
    expect(message.ack).toHaveBeenCalled();
    expect((await stored()).results).toEqual([expect.objectContaining({ phase: "after", angle: "front" })]);
  });
});
