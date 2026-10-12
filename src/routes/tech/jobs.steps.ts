import { z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import {
  latestArrival,
  measureArrival,
  passedArrivalStatement,
  recordFailedArrival,
  type ArrivalInput,
} from "../../domain/visits/check-ins.ts";
import { allConsumables } from "../../domain/field/consumables.ts";
import { profileLanded, recordAtVisit } from "../../domain/clients/hair-profiles.ts";
import {
  answerBeforeLanding,
  kindsLanded,
  landInOrder,
  jobChangesSince,
  type EventInput,
} from "../../domain/field/job-events.ts";
import { pieceLabelTaken, pieceStepOf } from "../../domain/field/pieces.ts";
import { checklistOf, jobSheet, knownCodes } from "../../domain/field/job-sheet-settings.ts";
import { hairSystemSpecs } from "../../domain/field/hair-systems.ts";
import { recordJobUse } from "../../domain/field/job-use.ts";
import { recordPieceUse } from "../../domain/field/piece-use.ts";
import { tellOfLowStock } from "../../domain/field/stock.ts";
import { noShowReadiness, openNoShowCase } from "../../domain/no-shows/no-shows.ts";
import { closeOneVisit } from "../../domain/visits/one-visit.ts";
import { progressOf } from "../../domain/field/job-card.ts";
import { type WorkableJob } from "../../domain/field/workable-job.ts";
import { refuse } from "../../http/errors.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { timeOfUuidV7 } from "../../lib/uuidv7.ts";
import { takesProfile } from "../../policy/hair-profile.ts";
import { noShowWaitEnds } from "../../policy/no-show.ts";
import { boundedPhoneTime } from "../../policy/phone-clock.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { queueMessage } from "../../http/queue-message.ts";
import { arrivalNotice } from "../../domain/messages/visit-messages.ts";

import {
  checkinRoute,
  startRoute,
  checklistRoute,
  consumablesRoute,
  pieceRoute,
  profileRoute,
  outcomeRoute,
  noShowRoute,
} from "./jobs.routes.ts";
import { ProfileRecordedSchema } from "./jobs.schemas.ts";
import {
  type Ctx,
  namedJob,
  step,
  isReplay,
  superseded,
  refusalOf,
  recordsOf,
  writeOf,
  refusedOf,
  resultOf,
  checkInReplayed,
  hasClosed,
} from "./jobs.record.ts";

import { pieceBody } from "./jobs.piece.ts";
import { registerPhotographs } from "./jobs.photos.ts";

export function registerTechJobSteps(app: App): void {
  registerArrival(app);
  registerNoShow(app);
  registerPhotographs(app);
  registerSteps(app);
  registerProfileAndOutcome(app);
}

/** The technician's arrival, and the start. */
function registerArrival(app: App): void {
  // Nothing is measured or recorded until the check-in may land: the job is theirs, today's, and as their phone holds it.
  // One sent again is answered from the check-in it landed as, and tells the client nothing.
  app.openapi(checkinRoute, async (c) => {
    const { deps } = c.var;
    const now = deps.now();
    const body = c.req.valid("json");
    const job = await namedJob(c, c.req.valid("param").id);
    if (job === null) return refuse(c, "not_found");

    const eventId = c.req.valid("header")["x-client-event-id"];
    const claimed = body.at === undefined ? timeOfUuidV7(eventId) : new Date(body.at);
    const inputs = await opsInputs(c);
    const at = boundedPhoneTime(claimed, { visitStart: job.windowStart, receivedAt: now }, inputs.phoneClock);
    const write = await writeOf({ c, job, kind: "check_in", body: { at: at.toISOString() }, phone: { at, claimed } });
    const answered = await answerBeforeLanding(c.env.DB, write);
    if (answered?.kind === "landed") return c.json(await checkInReplayed(c, job, answered.event), 200);
    if (answered !== null) return c.json(refusalOf(c, refusedOf(c, write, answered)), 409);

    const device = { lat: body.lat, lng: body.lng };
    // The steps the job holds are read beside the arrival's measure, in the same round trip to D1.
    const [measured, done] = await Promise.all([
      measureArrival(c.env.DB, {
        appointmentId: job.id,
        personId: job.personId,
        device,
        radiusM: inputs.checkinRadiusM,
      }),
      kindsLanded(c.env.DB, job.id),
    ]);
    c.var.log.info("technician_checked_in", {
      appointment_id: job.id,
      passed: measured.passed,
      distance_m: measured.distanceM,
      radius_m: measured.radiusM,
      waived: measured.waivedBy !== null,
    });
    const arrival: ArrivalInput = {
      appointmentId: job.id,
      technicianId: write.technicianId,
      device,
      accuracyM: body.accuracy_m ?? null,
      at,
      claimedAt: claimed,
      now,
      measured,
    };
    const answer = { distance_m: measured.distanceM, radius_m: measured.radiusM, checked_in_at: at.toISOString() };
    if (!measured.passed) {
      await recordFailedArrival(c.env.DB, arrival);
      return c.json({ passed: false, ...answer, wait_ends_at: null, accepted: null }, 200);
    }

    const checkIn: EventInput = { ...write, body: { at: at.toISOString(), distance_m: measured.distanceM } };
    const landing = await landInOrder(
      c.env.DB,
      {
        ...checkIn,
        records: await recordsOf(c, checkIn),
        withEvent: [passedArrivalStatement(c.env.DB, arrival, eventId)],
      },
      done,
    );
    if (landing.kind === "landed" && landing.replayed) {
      return c.json(await checkInReplayed(c, job, landing.event), 200);
    }
    const landed = await resultOf(c, checkIn, landing);
    if (!landed.ok) return c.json(refusalOf(c, landed), 409);
    if (job.personId !== null) await tellOfArrival(c, { personId: job.personId, appointmentId: job.id, arrivedAt: at });
    const waitEndsAt = noShowWaitEnds({ at, receivedAt: now }, job.windowStart, job.type, inputs.noShowWaitMin);
    return c.json({ passed: true, ...answer, wait_ends_at: waitEndsAt.toISOString(), accepted: landed.accepted }, 200);
  });

  app.openapi(startRoute, (c) => step(c, "start", () => ({})));
}

/** A no-show: the job closed with nobody home, once the wait has run out. */
function registerNoShow(app: App): void {
  // A job that changed under the phone is refused before its wait is read. The wait runs from the job's technician's
  // own check-in, so one given the job after another arrived must arrive themselves.
  app.openapi(noShowRoute, async (c) => {
    const { deps } = c.var;
    const now = deps.now();
    const job = await namedJob(c, c.req.valid("param").id);
    if (job === null) return refuse(c, "not_found");
    const write = await writeOf({ c, job, kind: "outcome", body: { outcome: "no_show" } });
    const answered = await answerBeforeLanding(c.env.DB, write);
    if (answered !== null && answered.kind !== "landed") {
      return c.json(refusalOf(c, refusedOf(c, write, answered)), 409);
    }

    const readiness = noShowReadiness(await latestArrival(c.env.DB, job), job, now, (await opsInputs(c)).noShowWaitMin);
    if (readiness.kind === "no_check_in") return refuse(c, "out_of_order");
    if (readiness.kind === "too_early") return refuse(c, "too_early_to_close");

    // The close lands first, so a job started opens no case.
    const landing = answered ?? (await landInOrder(c.env.DB, { ...write, records: await recordsOf(c, write) }));
    const landed = await resultOf(c, write, landing);
    if (!landed.ok) return c.json(refusalOf(c, landed), 409);
    const caseId = await openNoShowCase(c.env.DB, {
      appointmentId: job.id,
      checkIn: readiness.checkIn,
      waitStartsAt: readiness.waitStartsAt,
      waitEndsAt: readiness.waitEndsAt,
      now,
    });
    return c.json(
      {
        closed: true,
        wait_ends_at: readiness.waitEndsAt.toISOString(),
        case_id: caseId,
        accepted: landed.accepted,
      },
      200,
    );
  });
}

/** The steps on the card: the checklist, what was used, and the piece. */
function registerSteps(app: App): void {
  // An item ops have taken off since the phone kept the job is still one it may send.
  app.openapi(checklistRoute, (c) => {
    const { done } = c.req.valid("json");
    return step(c, "checklist", async (job) => {
      const list = checklistOf(await jobSheet(c.env.DB), { type: job.type, oneVisit: job.oneVisit !== null });
      const known = knownCodes(list);
      const unknown = done.filter((item) => !known.has(item));
      return unknown.length > 0 ? { invalid: ["done"] } : { done };
    });
  });

  // By code, or by name from a phone that queued the step before codes. A retired consumable is still taken:
  // it was used. What was used comes out of the technician's kit as the step lands, once however often it does. A
  // hair system is the piece step's, never this one's.
  app.openapi(consumablesRoute, (c) => {
    const { items } = c.req.valid("json");
    return step(
      c,
      "consumables",
      async () => {
        const hairSystems = await hairSystemSpecs(c.env.DB);
        const codes = new Set(
          (await allConsumables(c.env.DB)).flatMap((consumable) =>
            hairSystems.has(consumable.code) ? [] : [consumable.code],
          ),
        );
        return items.some((item) => "code" in item && !codes.has(item.code)) ? { invalid: ["items"] } : { items };
      },
      async (job) => {
        const { technicianId } = technicianOf(c);
        const { deps } = c.var;
        const used = await recordJobUse(c.env.DB, { job, technicianId, now: deps.now() });
        await tellOfLowStock(c.env.DB, deps, {
          touched: [technicianId],
          lowered: used.lowered ? [technicianId] : [],
        });
      },
    );
  });

  // The hair system fitted comes out of the technician's kit as the step lands, once however often it does.
  app.openapi(pieceRoute, (c) => {
    const body = c.req.valid("json");
    return step(
      c,
      "piece",
      async (job) => {
        const built = await pieceBody(c, job, body);
        if ("invalid" in built) return built;
        // A step sent again is answered as it landed the first time, whatever has been recorded since.
        if (await isReplay(c, job)) return built;
        const taken = await pieceLabelTaken(c.env.DB, job, pieceStepOf(built));
        return taken === null ? built : { labelTaken: taken };
      },
      async (job) => {
        const { technicianId } = technicianOf(c);
        const { deps } = c.var;
        const fitted = await recordPieceUse(c.env.DB, { jobId: job.id, technicianId, now: deps.now() });
        await tellOfLowStock(c.env.DB, deps, {
          touched: [technicianId],
          lowered: fitted.lowered ? [technicianId] : [],
        });
      },
    );
  });
}

/** The client's hair profile, and the outcome that closes the job. */
function registerProfileAndOutcome(app: App): void {
  // A new version of the client's profile, once however often the phone sends it. Like a step it is refused for a
  // job that changed under the phone, before the start, and on a visit that takes none; unlike one it is no job event,
  // and goes to no queue. A job with no client of ours has no profile step on its card; a write for one is answered
  // 202 and writes nothing, so the phone's queue for the job still sends its after photographs and its outcome.
  app.openapi(profileRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const { deps } = c.var;
    const job = await namedJob(c, c.req.valid("param").id);
    if (job === null) return refuse(c, "not_found");
    const headers = c.req.valid("header");
    const eventId = headers["x-client-event-id"];
    const { personId } = job;
    if (personId === null) {
      c.var.log.info("profile_without_client", { appointment_id: job.id });
      return c.json(await profileRecorded(c, job, eventId, false), 202);
    }
    if (await profileLanded(c.env.DB, job.id, eventId)) {
      return c.json(await profileRecorded(c, job, eventId, true), 202);
    }

    const heldStart = headers["x-job-starts-at"];
    const superseding = await jobChangesSince(
      c.env.DB,
      job,
      technicianId,
      heldStart === undefined ? null : new Date(heldStart),
    );
    if (superseding.changed.length > 0) {
      c.var.log.info("profile_superseded", { appointment_id: job.id, changed: superseding.changed });
      return c.json(refusalOf(c, superseded(superseding)), 409);
    }
    if (await hasClosed(c, job.id)) return refuse(c, "already_closed");
    if (!(await kindsLanded(c.env.DB, job.id)).has("start")) {
      return refuse(c, "out_of_order", ["start"]);
    }
    if (!takesProfile(job.type, job.oneVisit !== null)) {
      return refuse(c, "invalid_request", ["visit"]);
    }

    const { fit, history, based_on } = c.req.valid("json");
    const written = await recordAtVisit(c.env.DB, {
      personId,
      appointmentId: job.id,
      technicianId,
      eventId,
      fit,
      history,
      basedOn: based_on,
      now: deps.now(),
    });
    if (written.kind === "invalid") return refuse(c, "invalid_request", written.fields);
    if (written.fromOlder) await tellOfOlderBase(c, personId, written.versionId);
    return c.json(await profileRecorded(c, job, eventId, written.replayed), 202);
  });

  // The reasons ops set, partial and lost alike; one they have taken off since the phone kept the job is still taken. A one visit closed as
  // done becomes a consultation or the product's visit, and asks Razorpay for its payment link once, however often
  // it lands: the close lands whatever Razorpay answers, and the cron asks again for a link it could not make.
  app.openapi(outcomeRoute, (c) => {
    const body = c.req.valid("json");
    return step(
      c,
      "outcome",
      async () => {
        if (body.outcome === "done") {
          if (body.lost_reason === undefined) return { outcome: "done" };
          const lost = knownCodes((await jobSheet(c.env.DB)).lostReasons);
          return lost.has(body.lost_reason)
            ? { outcome: "done", lost_reason: body.lost_reason }
            : { invalid: ["lost_reason"] };
        }
        const known = knownCodes((await jobSheet(c.env.DB)).partialReasons);
        return known.has(body.reason) ? { outcome: "partial", reason: body.reason } : { invalid: ["reason"] };
      },
      async (job) => {
        if (job.oneVisit === null || body.outcome !== "done") return;
        const { deps, log, config } = c.var;
        await closeOneVisit(c.env.DB, { ...deps, log, messagingSettings: config.settings.messaging }, job, deps.now());
      },
    );
  });
}

/**
 * A profile the phone took from an older version than the latest, which it has now replaced: ops are told, by the
 * client's ID and the version's, to compare the two. Never a word of the profile.
 */
async function tellOfOlderBase(c: Ctx, personId: string, versionId: string): Promise<void> {
  await c.var.deps.alertOnce({
    key: `hair_profile_from_older:${versionId}`,
    message:
      `A technician's hair profile for client ${personId} (version ${versionId}) was taken from an older version ` +
      "than the latest, and is now the latest. Compare it with the version before it, and correct it if need be.",
    link: `/clients/${personId}/pieces`,
  });
}

/** The profile step's answer: the event, whether it had landed before, and where the job stands. */
async function profileRecorded(
  c: Ctx,
  job: WorkableJob,
  eventId: string,
  replayed: boolean,
): Promise<z.infer<typeof ProfileRecordedSchema>> {
  const { noShowWaitMin } = await opsInputs(c);
  return { event_id: eventId, replayed, progress: await progressOf(c.env.DB, job, noShowWaitMin) };
}

/**
 * The client's WhatsApp that their technician has arrived, the no-show's evidence (ADR 0047), once per visit. One
 * the queue drops, the sweeper sends; the check-in has landed either way.
 */
async function tellOfArrival(c: Ctx, input: { personId: string; appointmentId: string; arrivedAt: Date }) {
  const messageId = await arrivalNotice(c.env.DB, { ...input, now: c.var.deps.now() });
  if (messageId === null) return;
  await queueMessage(c, messageId);
}
