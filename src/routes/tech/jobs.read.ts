// The technician's reads (./jobs.ts): the day's jobs, one job's card, and the client's last visit.

import type { App } from "../../http/context.ts";
import { reservedForOthers } from "../../domain/purchasing/custom-orders.ts";
import { recalledIn } from "../../domain/inventory/recalls.ts";
import { type VisitType } from "../../config/visit-types.ts";
import { offeredForJob, serviceOfJob } from "../../domain/inventory/consumables.ts";
import { kitHairSystems } from "../../domain/inventory/hair-systems.ts";
import { kitUnits } from "../../domain/inventory/stock-units.ts";
import type { JobSheetItem } from "../../config/job-sheet.ts";
import { checklistOf, declinedChecklistOf, jobSheet } from "../../domain/field/job-sheet-settings.ts";
import { jobsOn } from "../../domain/field/tech-jobs.ts";
import { jobDetail, lastVisitPhoto } from "../../domain/field/job-card.ts";
import { refuse } from "../../http/errors.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { listableDate } from "../../policy/job-visibility.ts";
import { inputsIn, rulesOfVisit } from "../../domain/cities/city-rules.ts";
import { opsInputs } from "../../http/ops-inputs.ts";

import { jobsRoute, jobRoute, lastVisitPhotoRoute } from "./jobs.routes.ts";

/**
 * The kit's hair systems in the job card's words, for the piece step to pick and match to the client's profile, each
 * with the labels of its pieces, so a label scanned with no signal still names its hair system. A piece reserved to
 * another client's custom order is left out (docs/decisions/0175-custom-pieces-reserved.md), as is one of a recalled lot
 * (docs/decisions/0187-recalls.md).
 */
async function kitOf(db: D1Database, technicianId: string, job: { readonly id: string; readonly date: string }) {
  const reserved = new Map([
    ...(await reservedForOthers(db, technicianId, job.id)),
    ...(await recalledIn(db, technicianId)),
  ]);
  const units = (await kitUnits(db, technicianId)).filter((unit) => !reserved.has(unit.code));
  const kept = (code: string) => [...reserved.values()].filter((reservedCode) => reservedCode === code).length;
  return (await kitHairSystems(db, technicianId, job.date)).map((each) => ({
    code: each.code,
    name: each.name,
    held: each.held - kept(each.code),
    product: each.product,
    base_width_in: each.baseWidthIn,
    base_length_in: each.baseLengthIn,
    colour: each.colour,
    grey_percent: each.greyPercent,
    density_percent: each.densityPercent,
    units: units
      .filter((unit) => unit.consumableCode === each.code)
      .map((unit) => ({ code: unit.code, lot_code: unit.lotCode, expires_on: unit.expiresOn })),
  }));
}

/** A checklist as the phone shows it: the technician's words, not the client's. */
const forThePhone = (items: readonly JobSheetItem[]) => items.map(({ id, label }) => ({ id, label }));

export function registerTechJobReads(app: App): void {
  app.openapi(jobsRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const now = c.var.deps.now();
    const date = c.req.valid("query").date ?? indiaDate(now);
    // Nothing before yesterday: paging back through every date read every past client's card.
    if (!listableDate(date, now)) return refuse(c, "invalid_request", ["date"]);
    const { addressUnlockHour } = await opsInputs(c);
    return c.json(
      { date, jobs: await jobsOn({ db: c.env.DB, technicianId, date, now, unlockHour: addressUnlockHour }) },
      200,
    );
  });

  app.openapi(jobRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const inputs = await opsInputs(c);
    // The job sheet and the consumables as ops set them, which the phone keeps with the job for the day, and the rules
    // its city sets for itself.
    const jobId = c.req.valid("param").id;
    const [job, sheet, rules] = await Promise.all([
      jobDetail(c.env.DB, {
        technicianId,
        jobId,
        now: c.var.deps.now(),
        unlockHour: inputs.addressUnlockHour,
        waits: inputs.noShowWaitMin,
        phoneClock: inputs.phoneClock,
      }),
      jobSheet(c.env.DB),
      rulesOfVisit(c.env.DB, jobId),
    ]);
    if (job === null) return refuse(c, "not_found");
    const type: VisitType = job.type ?? "service";
    return c.json(
      {
        ...job,
        checkin_radius_m: inputsIn(inputs, rules).checkinRadiusM,
        checklist: forThePhone(checklistOf(sheet, { type, oneVisit: job.one_visit }).items),
        checklist_if_declined: job.one_visit ? forThePhone(declinedChecklistOf(sheet).items) : [],
        partial_reasons: [...sheet.partialReasons.items],
        lost_reasons: type === "consultation" || job.one_visit ? [...sheet.lostReasons.items] : [],
        consumables: await offeredForJob(c.env.DB, await serviceOfJob(c.env.DB, { id: job.id, type }), job.date),
        kit_hair_systems: job.steps.includes("piece") ? await kitOf(c.env.DB, technicianId, job) : [],
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
