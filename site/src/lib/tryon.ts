// The try-on's calls to the API, chained. The upload starts as soon as the
// visitor agrees to the photo notice, so it runs while they choose a stage and
// a look; the render starts when they press Generate, once the upload is done.

import { generateLook, requestUploadUrl, uploadPhoto, type GenerateRequest } from "./api.ts";
import type { PreparedPhoto } from "./photo.ts";
import { errorKindOf, jobProblem, type ErrorKind } from "./tryon-errors.ts";
import type { turnstileWidget } from "./turnstile.ts";

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ErrorKind };

export interface Uploaded {
  readonly jobId: string;
  readonly hairColor: PreparedPhoto["hairColor"];
}

const failed = (error: ErrorKind) => ({ ok: false, error }) as const;

export async function startUpload(
  preparing: Promise<PreparedPhoto>,
  turnstile: ReturnType<typeof turnstileWidget> | null,
  noticeVersion: string,
): Promise<Outcome<Uploaded>> {
  let photo: PreparedPhoto;
  try {
    photo = await preparing;
  } catch {
    return failed("photo");
  }

  const token = (await turnstile?.token()) ?? null;
  if (token === null) return failed("busy");
  const link = await requestUploadUrl({ photo_consent: true, notice_version: noticeVersion, turnstile_token: token });
  void turnstile?.renew();
  if (!link.ok) return failed(errorKindOf(link.code));

  const sent = await uploadPhoto(link.body.upload_url, photo.blob);
  if (!sent.ok) return failed(errorKindOf(sent.code));
  return { ok: true, value: { jobId: link.body.job_id, hairColor: photo.hairColor } };
}

/** Starts the render once the upload is done. The value is the job to follow. */
export async function startRender(
  uploading: Promise<Outcome<Uploaded>>,
  choice: Pick<GenerateRequest, "stage" | "preset">,
): Promise<Outcome<string>> {
  const uploaded = await uploading;
  if (!uploaded.ok) return uploaded;
  const answer = await generateLook({ job_id: uploaded.value.jobId, hair_color: uploaded.value.hairColor, ...choice });
  if (!answer.ok) return failed(errorKindOf(answer.code));
  const problem = jobProblem(answer.body);
  return problem === null ? { ok: true, value: answer.body.job_id } : failed(problem);
}
