// The photographs of a job: a link for each, the photograph and its small copy, and the set once complete
// (./jobs.steps.ts registers them with the other steps).

import type { App } from "../../http/context.ts";
import { jobChangesSince } from "../../domain/field/job-events.ts";
import { hasStorageRoom } from "../../domain/platform/storage-meter.ts";
import { workableJob, type WorkableJob } from "../../domain/field/workable-job.ts";
import {
  anglesHeld,
  MAX_PHOTO_BYTES,
  MAX_THUMBNAIL_BYTES,
  slotOfLink,
  storeTechnicianPhoto,
  storeThumbnail,
  uploadLink,
  type PhotoSlot,
} from "../../domain/field/tech-photos.ts";
import { type Phase } from "../../domain/field/visit-photos.ts";
import { cappedBody } from "../../http/capped-body.ts";
import { refuse } from "../../http/errors.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { takesStep } from "../../policy/in-job-steps.ts";
import { uploadUrlRoute, uploadRoute, smallUploadRoute, photosRoute } from "./jobs.routes.ts";
import { type Ctx, hasClosed, namedJob, step, superseded, refusalOf } from "./jobs.record.ts";

/**
 * Whether the job has closed, and whether the bucket has room for the bytes sent, read in one round trip to D1. The
 * body is read first, which needs nothing of D1; bytes too large to take ask for no room.
 */
function roomInOpenJob(c: Ctx, appointmentId: string, bytes: Uint8Array | null): Promise<[boolean, boolean]> {
  return Promise.all([
    hasClosed(c, appointmentId),
    bytes === null ? Promise.resolve(true) : hasStorageRoom(c.env.DB, c.var.deps.alertOnce, bytes.byteLength),
  ]);
}

/** The photographs: a link for each, the photograph and its small copy, and the set once complete. */
export function registerPhotographs(app: App): void {
  // A job given away or cancelled while its photographs waited on the phone says so, as a refused write does.
  app.openapi(uploadUrlRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const now = c.var.deps.now();
    const id = c.req.valid("param").id;
    const job = await namedJob(c, id);
    if (job === null) return refuse(c, "not_found");
    const superseding = await jobChangesSince(c.env.DB, job, technicianId, null);
    if (superseding.changed.length > 0) {
      c.var.log.info("upload_link_superseded", { appointment_id: job.id, changed: superseding.changed });
      return c.json(refusalOf(c, superseded(superseding)), 409);
    }
    if (await hasClosed(c, job.id)) return refuse(c, "already_closed");
    const { phase, angle } = c.req.valid("json");
    if (!takesPhotoSet(job, phase)) return refuse(c, "invalid_request", ["phase"]);
    const link = await uploadLink(c.var.config.settings.tryon.linkSigningKey, { appointmentId: id, phase, angle }, now);
    return c.json(
      { upload_url: link.url, small_upload_url: link.smallUrl, expires_at: link.expiresAt.toISOString() },
      201,
    );
  });

  app.openapi(uploadRoute, async (c) => {
    const { deps } = c.var;
    const now = deps.now();
    const slot = await uploadSlot(c, c.req.valid("param").token);
    if (slot === null) return refuse(c, "not_found");
    const bytes = await cappedBody(c.req.raw, MAX_PHOTO_BYTES);
    const [closed, room] = await roomInOpenJob(c, slot.appointmentId, bytes);
    if (closed) return refuse(c, "already_closed");
    if (bytes === null || bytes.byteLength === 0) return refuse(c, "photo_invalid_file");
    if (!room) return refuse(c, "busy");
    const stored = await storeTechnicianPhoto({
      db: c.env.DB,
      bucket: c.env.CLIENT_PHOTOS,
      slot,
      bytes,
      takenAt: now,
      now,
    });
    if (stored.kind === "not_an_image") return refuse(c, "photo_invalid_file");
    c.var.log.info("technician_photo_stored", { appointment_id: slot.appointmentId, phase: slot.phase });
    return c.json({ take: stored.take }, 200);
  });

  app.openapi(smallUploadRoute, async (c) => {
    const slot = await uploadSlot(c, c.req.valid("param").token);
    if (slot === null) return refuse(c, "not_found");
    const bytes = await cappedBody(c.req.raw, MAX_THUMBNAIL_BYTES);
    const [closed, room] = await roomInOpenJob(c, slot.appointmentId, bytes);
    if (closed) return refuse(c, "already_closed");
    if (bytes === null) return refuse(c, "photo_invalid_file");
    if (!room) return refuse(c, "busy");
    const stored = await storeThumbnail({
      db: c.env.DB,
      bucket: c.env.CLIENT_PHOTOS,
      slot,
      take: c.req.valid("query").take,
      bytes,
    });
    if (stored === "not_a_thumbnail") return refuse(c, "photo_invalid_file");
    if (stored === "no_photograph") return refuse(c, "upload_missing");
    return c.body(null, 204);
  });

  app.openapi(photosRoute, async (c) => {
    const phase = c.req.valid("json").phase;
    return step(c, photoStepOf(phase), async (job) => {
      if (!takesPhotoSet(job, phase)) return { invalid: ["phase"] };
      return { phase, angles: await anglesHeld(c.env.DB, job.id, phase) };
    });
  });
}

/** The slot an upload link names, while its job is still this technician's; null for any other link. */
async function uploadSlot(c: Ctx, token: string): Promise<PhotoSlot | null> {
  const slot = await slotOfLink(c.var.config.settings.tryon.linkSigningKey, token, c.var.deps.now());
  if (slot === null) return null;
  const job = await workableJob(c.env.DB, slot.appointmentId);
  return job?.technicianId === technicianOf(c).technicianId ? slot : null;
}

const photoStepOf = (phase: Phase) => (phase === "before" ? "before_photos" : "after_photos");

/** Whether the job takes this set of photographs: a consultation takes none after. */
function takesPhotoSet(job: WorkableJob, phase: Phase): boolean {
  return takesStep(photoStepOf(phase), job.type, job.oneVisit !== null);
}
