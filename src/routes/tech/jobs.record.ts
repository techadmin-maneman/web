// Recording a technician's step (./jobs.steps.ts): the job it names, the write it carries, landing it once
// with what its step records, and the answer, accepted or refused.

import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../../http/context.ts";
import { arrivalOfEvent } from "../../domain/check-ins.ts";
import {
  eventByClientId,
  landJobEvent,
  wasTheirs,
  type EventInput,
  type JobEvent,
  type Landing,
  type MovedTo,
  type Superseding,
} from "../../domain/job-events.ts";
import { jobRecordOf, type LandingStep } from "../../domain/job-record.ts";
import { type PieceField } from "../../domain/pieces.ts";
import { progressOf, workableJob, type WorkableJob } from "../../domain/tech-jobs.ts";
import { errorBody, type ErrorResponse, refuse } from "../../http/errors.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { timeOfUuidV7 } from "../../lib/uuidv7.ts";
import { type JobEventKind } from "../../policy/in-job-steps.ts";
import { noShowWaitEnds } from "../../policy/no-show.ts";
import { boundedPhoneTime } from "../../policy/phone-clock.ts";
import { opsInputs } from "../../http/ops-inputs.ts";

import { EVENT_ID_HEADER, JOB_STARTS_AT_HEADER, AcceptedSchema, CheckInSchema } from "./jobs.schemas.ts";

export type Ctx = Context<AppEnv>;

/**
 * The job a write names, while it is or was this technician's: one moved to someone else is answered `superseded`,
 * with what changed, so the phone can tell him. Any other job is not found, and nothing of it is answered.
 */
export async function namedJob(c: Ctx, id: string): Promise<WorkableJob | null> {
  const job = await workableJob(c.env.DB, id);
  if (job === null) return null;
  return (await wasTheirs(c.env.DB, job, technicianOf(c).technicianId)) ? job : null;
}

/**
 * What a step's handler returns: the event's body, the fields that were wrong, or the piece label already on record,
 * by its field.
 */
export type StepBody = Record<string, unknown> | { invalid: string[] } | { labelTaken: PieceField };

/**
 * One in-job step: check it, land it once, and record what it does with the event.
 * What a step keeps of its own, `afterRecorded` does once it has landed, first time
 * or replayed, and must do the same however often it is called.
 */
export async function step(
  c: Ctx,
  kind: JobEventKind,
  build: (job: WorkableJob) => StepBody | Promise<StepBody>,
  afterRecorded?: (job: WorkableJob) => Promise<void>,
) {
  const job = await namedJob(c, c.req.param("id") ?? "");
  if (job === null) return refuse(c, "not_found");
  const built = await build(job);
  if ("invalid" in built && Array.isArray(built.invalid)) {
    return refuse(c, "invalid_request", built.invalid);
  }
  if ("labelTaken" in built && typeof built.labelTaken === "string") {
    return refuse(c, "piece_code", [built.labelTaken]);
  }
  const landing = await recordStep(c, job, kind, built);
  if (!landing.ok) return c.json(refusalOf(c, landing), 409);
  if (afterRecorded !== undefined) await afterRecorded(job);
  return c.json(landing.accepted, 202);
}

/** Whether this step's event ID has already landed on the job. */
export async function isReplay(c: Ctx, job: WorkableJob): Promise<boolean> {
  const eventId = c.req.header(EVENT_ID_HEADER) ?? "";
  return (await eventByClientId(c.env.DB, job.id, eventId)) !== null;
}

/** What landing an event came to: the write, or the 409 the route answers. */
export type StepResult =
  | { readonly ok: true; readonly accepted: z.infer<typeof AcceptedSchema> }
  | {
      readonly ok: false;
      readonly code:
        "superseded" | "out_of_order" | "not_today" | "already_started" | "already_closed" | "too_early_to_arrive";
      readonly fields?: string[];
      /** On a job given to another technician: whom, by first name, and when (docs/open-points.md, item 92). */
      readonly moved?: MovedTo;
      /** On a check-in or a start too early: the earliest moment the job takes one. */
      readonly earliest?: Date;
    };

/** The 409 of a job that changed under the phone: what changed, and whom it went to where that is to be said. */
export function superseded(superseding: Superseding): Extract<StepResult, { ok: false }> {
  const fields = [...superseding.changed];
  if (superseding.moved === null) return { ok: false, code: "superseded", fields };
  return { ok: false, code: "superseded", fields, moved: superseding.moved };
}

/**
 * A refused write's 409: its code and fields; for a job given to another technician, whom and when; and for a
 * check-in or a start too early, when the job takes one.
 */
export function refusalOf(c: Ctx, refused: Extract<StepResult, { ok: false }>): ErrorResponse {
  const body = errorBody(refused.code, c.var.requestId, refused.fields);
  if (refused.moved !== undefined) return { error: { ...body.error, moved: refused.moved } };
  if (refused.earliest !== undefined) return { error: { ...body.error, earliest_at: refused.earliest.toISOString() } };
  return body;
}

/** What the write's step records, written with the event (src/domain/job-record.ts). */
export async function recordsOf(c: Ctx, write: EventInput): Promise<D1PreparedStatement[]> {
  const { pieceCycleDays } = await opsInputs(c);
  const step: LandingStep = {
    visit: write.job,
    kind: write.kind,
    body: write.body,
    occurredAt: write.occurredAt,
    cycles: pieceCycleDays,
    now: write.now,
  };
  return jobRecordOf(c.env.DB, step);
}

/**
 * The write a request carries: whose, from which phone, its event ID, and the job's start as the phone holds it. Its
 * time is the phone's, within bounds: the check-in passes its own, and any other write's comes from its event ID.
 */
export async function writeOf(
  c: Ctx,
  job: WorkableJob,
  kind: JobEventKind,
  body: Record<string, unknown>,
  phone?: { at: Date; claimed: Date | null },
): Promise<EventInput> {
  const { technicianId, deviceRowId } = technicianOf(c);
  const now = c.var.deps.now();
  const eventId = c.req.header(EVENT_ID_HEADER) ?? "";
  const heldStart = c.req.header(JOB_STARTS_AT_HEADER);
  const { phoneClock } = await opsInputs(c);
  const bounds = { visitStart: job.windowStart, receivedAt: now };
  return {
    job,
    technicianId,
    deviceRowId,
    eventId,
    kind,
    body,
    occurredAt: phone?.at ?? boundedPhoneTime(timeOfUuidV7(eventId), bounds, phoneClock),
    claimedAt: phone === undefined ? timeOfUuidV7(eventId) : phone.claimed,
    expectedStart: heldStart === undefined ? null : new Date(heldStart),
    now,
    phoneClock,
  };
}

/** Records one event, and the step's work, in one batch. */
export async function recordStep(
  c: Ctx,
  job: WorkableJob,
  kind: JobEventKind,
  body: Record<string, unknown>,
): Promise<StepResult> {
  const write = await writeOf(c, job, kind, body);
  const landing = await landJobEvent(c.env.DB, { ...write, records: await recordsOf(c, write) });
  return resultOf(c, write, landing);
}

export type Refusal = Exclude<Landing, { kind: "landed" }>;

/** The 409 of a write that may not land. */
export function refusedOf(c: Ctx, write: EventInput, refusal: Refusal): Extract<StepResult, { ok: false }> {
  if (refusal.kind === "superseded") {
    c.var.log.info("job_event_superseded", {
      appointment_id: write.job.id,
      kind: write.kind,
      changed: refusal.changed,
    });
    return superseded(refusal);
  }
  if (refusal.kind === "out_of_order") return { ok: false, code: "out_of_order", fields: [refusal.needs] };
  if (refusal.kind === "too_early") return { ok: false, code: "too_early_to_arrive", earliest: refusal.earliest };
  return { ok: false, code: refusal.kind };
}

/** What landing a write came to: accepted, with where the job stands now, or refused. */
export async function resultOf(c: Ctx, write: EventInput, landing: Landing): Promise<StepResult> {
  if (landing.kind !== "landed") return refusedOf(c, write, landing);
  return { ok: true, accepted: await acceptedOf(c, write.job, landing.event, landing.replayed) };
}

export async function acceptedOf(
  c: Ctx,
  job: WorkableJob,
  event: JobEvent,
  replayed: boolean,
): Promise<z.infer<typeof AcceptedSchema>> {
  const { noShowWaitMin } = await opsInputs(c);
  return {
    event_id: event.eventId,
    replayed,
    fsm_write_state: event.writeState,
    progress: await progressOf(c.env.DB, job, noShowWaitMin),
  };
}

/**
 * A check-in sent again, answered from the row it landed as, so nothing is measured, recorded or told again. One that
 * landed before its row named its event is answered from where the job stands.
 */
export async function checkInReplayed(
  c: Ctx,
  job: WorkableJob,
  event: JobEvent,
): Promise<z.infer<typeof CheckInSchema>> {
  const { noShowWaitMin, checkinRadiusM } = await opsInputs(c);
  const accepted = await acceptedOf(c, job, event, true);
  const arrival = await arrivalOfEvent(c.env.DB, event.id);
  if (arrival === null) {
    const { progress } = accepted;
    return {
      passed: true,
      distance_m: progress.distance_m,
      radius_m: checkinRadiusM,
      checked_in_at: event.occurredAt,
      wait_ends_at: progress.wait_ends_at,
      accepted,
    };
  }
  return {
    passed: true,
    distance_m: arrival.distanceM,
    radius_m: arrival.radiusM,
    checked_in_at: arrival.at.toISOString(),
    wait_ends_at: noShowWaitEnds(arrival, job.windowStart, job.type, noShowWaitMin).toISOString(),
    accepted,
  };
}
