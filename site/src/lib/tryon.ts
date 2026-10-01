// The try-on's calls to the API around the gate. The upload starts as soon as
// the visitor agrees to the photo notice, so it runs while they choose a stage
// and a look; the render starts once the gate has the number the look goes to
// (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md). Under a notice
// that keeps a client's try-on, the photograph's small copy follows it; a copy
// refused leaves the try-on as it is (ADR 0084).

import {
  fetchAvailability,
  fetchLook,
  generateLook,
  requestUploadUrl,
  uploadCopy,
  uploadPhoto,
  type ErrorCode,
  type GenerateRequest,
} from "./api.ts";
import type { PreparedPhoto } from "./photo.ts";
import { errorKindOf, jobProblem, type Failure } from "./tryon-errors.ts";
import type { turnstileWidget } from "./turnstile.ts";

export type Outcome<T> = { readonly ok: true; readonly value: T } | ({ readonly ok: false } & Failure);

export interface Uploaded {
  readonly jobId: string;
  readonly hairColor: PreparedPhoto["hairColor"];
}

const failed = (failure: Failure) => ({ ok: false, ...failure }) as const;
/** An API refusal, by its code. */
const refused = (code: ErrorCode | "network") => failed({ kind: errorKindOf(code), code });

/** Where a visitor stands on arrival: free to start, back after their look, or the try-on cannot run at all. */
export type Arrival = "open" | "hadLook" | "unavailable";

/**
 * Asked on arrival, so that a visitor is not asked for a photograph the API would refuse (CLI-29). A look that failed
 * does not count, so its visitor may try another photograph. Unanswered, the visitor starts, as before.
 */
export async function onArrival(): Promise<Arrival> {
  const [look, availability] = await Promise.all([fetchLook(), fetchAvailability()]);
  if (look.ok && look.body.state !== "failed") return "hadLook";
  if (availability.ok && !availability.body.available) return "unavailable";
  return "open";
}

export async function startUpload(
  preparing: Promise<PreparedPhoto>,
  turnstile: ReturnType<typeof turnstileWidget> | null,
  noticeVersion: string,
): Promise<Outcome<Uploaded>> {
  let photo: PreparedPhoto;
  try {
    photo = await preparing;
  } catch {
    return failed({ kind: "photo", code: "photo_invalid_file" });
  }

  const token = (await turnstile?.token()) ?? null;
  if (token === null) return failed({ kind: "busy", code: "turnstile_unavailable" });
  const link = await requestUploadUrl({ photo_consent: true, notice_version: noticeVersion, turnstile_token: token });
  void turnstile?.renew();
  if (!link.ok) return refused(link.code);

  const sent = await uploadPhoto(link.body.upload_url, photo.blob);
  if (!sent.ok) return refused(sent.code);
  if (photo.copy !== null) await uploadCopy(link.body.upload_url, photo.copy);
  return { ok: true, value: { jobId: link.body.job_id, hairColor: photo.hairColor } };
}

/** Starts the render of a claimed try-on, for the stage its claim gave. The value is the job to follow. */
export async function startRender(uploaded: Uploaded, preset: GenerateRequest["preset"]): Promise<Outcome<string>> {
  const answer = await generateLook({ job_id: uploaded.jobId, hair_color: uploaded.hairColor, preset });
  if (!answer.ok) return refused(answer.code);
  const problem = jobProblem(answer.body);
  return problem === null ? { ok: true, value: answer.body.job_id } : failed(problem);
}
