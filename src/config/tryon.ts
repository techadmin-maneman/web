// The try-on's fixed vocabulary and limits. Presets are in presets.ts.
// See docs/decisions/0014-try-on-api.md.

import { LOSS_EXTENTS } from "./booking.ts";

/** The three hair-loss stages the try-on asks about: the booking form's loss extents. */
export const TRYON_STAGES = LOSS_EXTENTS;

/**
 * What the browser's colour detector reports. Only natural shades; `unknown`
 * when it cannot read the hair, which is routed by UNKNOWN_COLOR_ROUTE.
 */
export const HAIR_COLORS = ["black", "brown", "lightBrown", "grey", "silver", "white", "unknown"] as const;
export type HairColor = (typeof HAIR_COLORS)[number];

/** How a job with hair_color `unknown` is rendered. */
export const UNKNOWN_COLOR_ROUTES = ["premium_original", "pro_black"] as const;
export type UnknownColorRoute = (typeof UNKNOWN_COLOR_ROUTES)[number];

export const JOB_STATES = [
  "awaiting_upload",
  "queued",
  "rendering",
  "downloading",
  "ready",
  "failed",
  "expired",
] as const;
export type JobState = (typeof JOB_STATES)[number];

/** Still going: the customer should keep waiting. */
export const RUNNING_STATES: readonly JobState[] = ["queued", "rendering", "downloading"];

/** Why a job failed, as the customer's page is told. */
export const FAILURE_CODES = ["photo_unreadable", "photo_invalid_file", "render_failed", "busy"] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

/** Upload limits: AILabTools' own (docs/reference/ailabtools-api-notes.md, sections 3 and 4). */
export const UPLOAD_CONTENT_TYPES = ["image/jpeg", "image/png"] as const;
export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/**
 * The largest result stored. It sizes the R2 storage budget (docs/decisions/0009),
 * and WhatsApp takes images of 5 MB at most. A larger result fails the job with an alert.
 */
export const MAX_RESULT_BYTES = 6 * 1024 * 1024;
/** An upload link lasts 5 minutes and a session 30; a photo is deleted an hour after its last look. */
export const PHOTO_RETENTION_MS = 60 * 60 * 1000;
export const MIN_SIDE_PX = 200;
/** Premium's documented maximum; Pro's is 4095. */
export const MAX_SIDE_PX = 4090;

/** How long the upload link from POST /api/tryon/upload-url works. */
export const UPLOAD_LINK_TTL_MS = 5 * 60 * 1000;
/** The mm_tryon cookie and its session. */
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const SESSION_COOKIE = "mm_tryon";
/** One look per visitor: the browser remembers its render this long, the photos' retention period. */
export const LOOK_COOKIE = "mm_look";
export const LOOK_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** The link GET /api/tryon/result hands the browser. */
export const RESULT_LINK_BROWSER_TTL_MS = 15 * 60 * 1000;
/** The link a WhatsApp message carries, minted at send time. */
export const RESULT_LINK_MESSAGE_TTL_MS = 60 * 60 * 1000;
