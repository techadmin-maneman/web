// The technician's reads (./jobs.ts): the day's jobs, one job's card, and the client's last visit.

import type { App } from "../../http/context.ts";
import { type VisitType } from "../../config/visit-types.ts";
import { offeredForJob, serviceOfJob } from "../../domain/consumables.ts";
import { checklistOf, declinedChecklistOf, jobSheet } from "../../domain/job-sheet-settings.ts";
import { jobDetail, jobsOn, lastVisitPhoto } from "../../domain/tech-jobs.ts";
import { refuse } from "../../http/errors.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { listableDate } from "../../policy/job-visibility.ts";
import { opsInputs } from "../../http/ops-inputs.ts";

import { jobsRoute, jobRoute, lastVisitPhotoRoute } from "./jobs.routes.ts";

export function registerTechJobReads(app: App): void {
  app.openapi(jobsRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const now = c.var.deps.now();
    const date = c.req.valid("query").date ?? indiaDate(now);
    // Nothing before yesterday: paging back through every date read every past client's card (FLD-18).
    if (!listableDate(date, now)) return refuse(c, "invalid_request", ["date"]);
    const { addressUnlockHour } = await opsInputs(c);
    return c.json({ date, jobs: await jobsOn(c.env.DB, technicianId, date, now, addressUnlockHour) }, 200);
  });

  app.openapi(jobRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const inputs = await opsInputs(c);
    // The job sheet and the consumables as ops set them, which the phone keeps with the job for the day.
    const [job, sheet] = await Promise.all([
      jobDetail(c.env.DB, {
        technicianId,
        jobId: c.req.valid("param").id,
        now: c.var.deps.now(),
        unlockHour: inputs.addressUnlockHour,
        waits: inputs.noShowWaitMin,
        phoneClock: inputs.phoneClock,
      }),
      jobSheet(c.env.DB),
    ]);
    if (job === null) return refuse(c, "not_found");
    const type: VisitType = job.type ?? "service";
    return c.json(
      {
        ...job,
        checkin_radius_m: inputs.checkinRadiusM,
        checklist: [...checklistOf(sheet, { type, oneVisit: job.one_visit }).items],
        checklist_if_declined: job.one_visit ? [...declinedChecklistOf(sheet).items] : [],
        partial_reasons: [...sheet.partialReasons.items],
        consumables: await offeredForJob(c.env.DB, await serviceOfJob(c.env.DB, { id: job.id, type }), job.date),
      },
      200,
    );
  });

  app.openapi(lastVisitPhotoRoute, async (c) => {
    const photo = await lastVisitPhoto(c.env.DB, {
      technicianId: technicianOf(c).technicianId,
      jobId: c.req.valid("param").id,
      now: c.var.deps.now(),
      unlockHour: (await opsInputs(c)).addressUnlockHour,
    });
    const object = photo === null ? null : await c.env.CLIENT_PHOTOS.get(photo.key);
    if (photo === null || object === null) return refuse(c, "not_found");
    // A client's photograph stays off a technician's phone: neither the browser nor the service worker keeps it.
    return new Response(object.body, {
      headers: { "Content-Type": photo.contentType, "Cache-Control": "private, no-store" },
    });
  });
}
