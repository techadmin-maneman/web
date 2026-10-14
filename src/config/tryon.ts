// The try-on's fixed vocabulary and limits. Presets are in presets.ts.
// See docs/decisions/0014-try-on-api.md.

import { LOSS_EXTENTS } from "./booking.ts";
import { HOUR_MS, MINUTE_MS } from "../lib/durations.ts";

/** The three hair-loss stages the try-on asks about: the booking form's loss extents. */
export const TRYON_STAGES = LOSS_EXTENTS;

/**
 * The colours the site used to send. The look keeps the visitor's own colour now, so none is chosen; the site of the
 * release before still sends one, which is taken and ignored until the next release.
 */
export const HAIR_COLORS = ["black", "brown", "lightBrown", "grey", "silver", "white", "unknown"] as const;

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

/** Why a job failed, as the customer's page is told. */
export const FAILURE_CODES = ["photo_unreadable", "photo_invalid_file", "render_failed", "busy"] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

/**
 * What the page says beyond the failure code: the fault YouCam found in the photograph, or the try-on paused for want
 * of units or a working key (docs/reference/youcam-api-notes.md, section 4).
 */
export const FAILURE_REASONS = [
  "no_face",
  "no_shoulders",
  "face_angle",
  "several_people",
  "not_styleable",
  "refused",
  "unavailable",
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/** The upload limit: under YouCam's 10 MB, and far above what the browser's 1024 px JPEG comes to. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/**
 * The largest result stored: WhatsApp takes images of 5 MB at most, and the cap
 * also sizes the R2 storage budget (docs/decisions/0194). A larger result, or one
 * that is not an image, fails the job at once with an alert (docs/decisions/0015).
 */
export const MAX_RESULT_BYTES = 5 * 1024 * 1024;
/** A photograph is deleted an hour after its last look. */
export const PHOTO_RETENTION_MS = HOUR_MS;
/** The longest a look may be kept (RESULT_RETENTION_DAYS): the photo notice says fourteen days at most. */
export const MAX_RESULT_RETENTION_DAYS = 14;
export const MIN_SIDE_PX = 200;
/** YouCam takes a photograph 1024 px on its long side at most; the browser makes it so. */
export const MAX_SIDE_PX = 1024;
/**
 * The small copy of the photograph a client keeps as their before photo (docs/decisions/0084-a-clients-try-on-is-kept.md),
 * re-encoded in the browser as a visit photograph is on the technician's phone: a JPEG of about 250 KB, at most
 * 1600 px on its long side.
 */
export const MAX_COPY_BYTES = 250 * 1024;
export const COPY_LONG_EDGE_PX = 1600;

/** How long the upload link from POST /api/tryon/upload-url works. */
export const TRYON_UPLOAD_LINK_TTL_MS = 5 * MINUTE_MS;
/** One look per visitor: the browser remembers for 30 days that it has had its look. */
export const LOOK_COOKIE = "mm_look";
/**
 * The link a WhatsApp message carries, minted at send time: the only link to a look there is, since the look goes to
 * WhatsApp only (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md).
 */
export const RESULT_LINK_MESSAGE_TTL_MS = HOUR_MS;
