// The technician API's routes (./jobs.ts), made of its schemas (./jobs.schemas.ts).

import { techRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import {
  ChecklistRequestSchema,
  ConsumablesRequestSchema,
  OutcomeRequestSchema,
  PieceRequestSchema,
} from "../../domain/job-event-bodies.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import {
  jobId,
  EventIdSchema,
  JobsSchema,
  JobDetailSchema,
  AcceptedSchema,
  CheckInRequestSchema,
  CheckInSchema,
  UploadUrlRequestSchema,
  UploadUrlSchema,
  PhotosRequestSchema,
  NoShowSchema,
  ProfileRequestSchema,
  ProfileRecordedSchema,
} from "./jobs.schemas.ts";

const RECORDED = { description: "Recorded", ...json(AcceptedSchema) };

const CLOSED = "already_closed: the job has closed; only its checklist and consumables may be corrected, for an hour";
const PHOTOS_CLOSED = "already_closed: the job has closed, so it takes no more photographs";

/** What every in-job write can be refused with. A route with more to say of a conflict says it after these. */
const STEP_REFUSALS = {
  400: errorResponse("invalid_request: see error.fields"),
  401: errorResponse("session_required; device_revoked: ops revoked this phone, so drop the cached jobs"),
  404: errorResponse("not_found: no such job, or never this technician's"),
  409: errorResponse(
    `superseded: the job changed under the phone; out_of_order: send the step before this one first; ${CLOSED}`,
  ),
};

/** A check-in's or a start's conflict, which may also be on the wrong day or too early in it. */
const DAY_CONFLICT = errorResponse(
  `superseded: the job changed under the phone; out_of_order: send the step before this one first; ${CLOSED}; ` +
    "not_today: the job is on another day; too_early_to_arrive: before the earliest check-in, which error.earliest_at gives",
);

export const jobsRoute = techRoute({
  method: "get",
  path: "/api/tech/jobs",
  summary: "The technician's jobs on a date. Today and tomorrow in full; later dates only time, type and sector",
  request: { query: z.object({ date: z.iso.date().optional() }) },
  responses: {
    200: { description: "The day's jobs, in time order", ...json(JobsSchema) },
    400: errorResponse("invalid_request: a date before yesterday"),
    401: errorResponse("session_required; device_revoked"),
  },
});

export const jobRoute = techRoute({
  method: "get",
  path: "/api/tech/jobs/{id}",
  summary: "One of the technician's jobs, with the day-before unlock enforced",
  request: { params: jobId },
  responses: {
    200: { description: "The job", ...json(JobDetailSchema) },
    401: errorResponse("session_required; device_revoked"),
    404: errorResponse("not_found: no such job of this technician's"),
  },
});

export const lastVisitPhotoRoute = techRoute({
  method: "get",
  path: "/api/tech/jobs/{id}/last-visit-photo",
  summary: "The client's last visit, after: one photograph, under the card's own unlock, never cached",
  request: { params: jobId },
  responses: {
    200: {
      description: "The image",
      content: { "image/jpeg": { schema: z.string() }, "image/png": { schema: z.string() } },
    },
    401: errorResponse("session_required; device_revoked"),
    404: errorResponse(
      "not_found: no such job of this technician's, not unlocked yet, or no earlier visit's photograph",
    ),
  },
});

export const checkinRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/checkin",
  summary: "I have arrived: the time and the phone's position, inside the geofence",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(CheckInRequestSchema) } },
  responses: {
    200: { description: "Pass or fail, with the distance", ...json(CheckInSchema) },
    ...STEP_REFUSALS,
    409: DAY_CONFLICT,
  },
});

export const startRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/start",
  summary: "Start the job. The duration runs from here to the outcome",
  request: { params: jobId, headers: EventIdSchema },
  responses: {
    202: RECORDED,
    ...STEP_REFUSALS,
    409: DAY_CONFLICT,
  },
});

export const uploadUrlRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/photos/upload-url",
  summary: "A link to PUT one photograph to, for one phase and angle",
  request: { params: jobId, body: { required: true, ...json(UploadUrlRequestSchema) } },
  responses: {
    201: { description: "The link, good for fifteen minutes", ...json(UploadUrlSchema) },
    400: errorResponse("invalid_request"),
    401: errorResponse("session_required; device_revoked"),
    404: errorResponse("not_found: no such job, or never this technician's"),
    409: errorResponse(
      "superseded: the job was given to another technician or cancelled while its photographs waited; moved names " +
        `whom; ${PHOTOS_CLOSED}`,
    ),
  },
});

const PhotoTakenSchema = z
  .object({
    take: z
      .uuid()
      .openapi({ description: "This upload of the angle's photograph, which its small copy's upload names." }),
  })
  .strict()
  .openapi("TechnicianPhotoTaken");

export const uploadRoute = techRoute({
  method: "put",
  path: "/api/tech/photos/{token}",
  summary: "The photograph itself: a JPEG or PNG, at most 2 MB",
  request: { params: z.object({ token: z.string().min(1).max(500) }) },
  responses: {
    200: { description: "Received", ...json(PhotoTakenSchema) },
    401: errorResponse("session_required; device_revoked"),
    404: errorResponse("not_found: the link is wrong or expired"),
    409: errorResponse(PHOTOS_CLOSED),
    422: errorResponse("photo_invalid_file: not a JPEG or PNG, or over 2 MB"),
    503: errorResponse("busy: R2 holds past the runaway ceiling; the phone keeps the photograph and sends it later"),
  },
});

export const smallUploadRoute = techRoute({
  method: "put",
  path: "/api/tech/photos/{token}/small",
  summary: "The photograph's small copy, for the client app's rows: a JPEG of at most 64 KB and 800 px a side",
  request: {
    params: z.object({ token: z.string().min(1).max(500) }),
    query: z.object({ take: z.uuid().openapi({ description: "The take the photograph's upload answered." }) }),
  },
  responses: {
    204: { description: "Received, or held already" },
    401: errorResponse("session_required; device_revoked"),
    404: errorResponse("not_found: the link is wrong or expired"),
    409: errorResponse(
      "upload_missing: that take is not the angle's photograph: not arrived yet, or taken again since; " +
        PHOTOS_CLOSED,
    ),
    422: errorResponse("photo_invalid_file: not a JPEG, or over 64 KB or 800 px a side"),
    503: errorResponse("busy: R2 holds past the runaway ceiling"),
  },
});

export const photosRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/photos",
  summary: "The phase's five photographs are in",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(PhotosRequestSchema) } },
  responses: {
    202: RECORDED,
    ...STEP_REFUSALS,
  },
});

export const checklistRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/checklist",
  summary: "The service checklist, per visit type",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(ChecklistRequestSchema) } },
  responses: {
    202: RECORDED,
    ...STEP_REFUSALS,
  },
});

export const consumablesRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/consumables",
  summary: "Consumables used, with quantities",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(ConsumablesRequestSchema) } },
  responses: {
    202: RECORDED,
    ...STEP_REFUSALS,
  },
});

export const pieceRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/piece",
  summary: "The piece: a replacement's, a first fit's and a one visit's step only",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(PieceRequestSchema) } },
  responses: {
    202: RECORDED,
    ...STEP_REFUSALS,
    409: errorResponse(
      `superseded: the job changed under the phone; out_of_order: send the step before this one first; ${CLOSED}; ` +
        "piece_code: a label already on record, as another client's piece or this client's from an earlier visit, " +
        "or a piece that came off that is another client's. error.fields names piece_code or old_piece, to correct " +
        "and send again",
    ),
  },
});

export const profileRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/profile",
  summary: "The client's hair profile, the fit spec and their history, as a new version",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(ProfileRequestSchema) } },
  responses: {
    202: {
      description:
        "Recorded; or, for a job with no client of ours, taken and nothing written. One taken from an older version " +
        "than the latest still lands, and ops are told.",
      ...json(ProfileRecordedSchema),
    },
    ...STEP_REFUSALS,
    400: errorResponse("invalid_request: see error.fields; visit, for a visit that takes no profile"),
  },
});

export const outcomeRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/outcome",
  summary: "Done, or partial with a reason",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(OutcomeRequestSchema) } },
  responses: {
    202: RECORDED,
    ...STEP_REFUSALS,
  },
});

export const noShowRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/no-show",
  summary: "Close the job as a no-show, once the wait has run",
  request: { params: jobId, headers: EventIdSchema },
  responses: {
    200: { description: "Closed, with the case ops will rule on", ...json(NoShowSchema) },
    ...STEP_REFUSALS,
    409: errorResponse(
      `superseded: the job changed under the phone; out_of_order: send the step before this one first; ${CLOSED}; ` +
        "already_started: the job was started, so the client was home",
    ),
    425: errorResponse("too_early_to_close: the wait has not run out"),
  },
});
