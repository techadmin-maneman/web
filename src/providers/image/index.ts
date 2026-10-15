// The image provider, behind an interface. Callers use ImageProvider; only this file knows which implementation runs,
// and only youcam.ts knows YouCam (docs/decisions/0201-the-try-on-on-youcam.md). The render consumer is the only caller.

import type { PresetId } from "../../config/presets.ts";
import type { FailureCode, FailureReason } from "../../config/tryon.ts";
import type { ImageType } from "../../lib/image-bytes.ts";
import type { Logger } from "../../log.ts";
import { createStubYoucamFetch, STUB_API_KEY } from "./stub.ts";
import { createYoucamProvider } from "./youcam.ts";

export interface RenderFailure {
  /** What the customer's page is told. */
  readonly code: Exclude<FailureCode, "busy">;
  /** What the page says beyond the code: the fault YouCam found in the photograph, or the try-on paused. */
  readonly reason?: FailureReason;
  /** Worth trying again: a timeout, a 5xx or a 429. A refused photo is not. */
  readonly transient: boolean;
  /** Worth one more render from the start: YouCam's own model failed on a photograph it took. */
  readonly retryOnce?: boolean;
  /** Ops must act: the key was refused, the units ran out, or a request of ours was wrong. */
  readonly alert: boolean;
  /** Pages ops too, under this alert key, until resolved: no try-on can run until someone acts. */
  readonly urgentKey?: string;
  /** For D1 and the logs, with YouCam's code verbatim and the API key scrubbed out. Never shown to the customer. */
  readonly detail: string;
}

export type SubmitResult =
  { readonly ok: true; readonly taskId: string } | { readonly ok: false; readonly failure: RenderFailure };

export type PollResult =
  | { readonly state: "running" }
  | { readonly state: "done"; readonly resultUrl: string }
  | { readonly state: "failed"; readonly failure: RenderFailure };

export type DownloadResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly contentType: ImageType }
  | {
      readonly ok: false;
      readonly detail: string;
      /** Worth trying again: the host stalled or failed. A result too large, or not an image, never will be. */
      readonly transient: boolean;
    };

export interface ImageProvider {
  /** Starts a render of the photograph in a look, named by its id; how the look is made is the provider's own. */
  submit(image: Uint8Array, look: PresetId): Promise<SubmitResult>;
  /** What a render made in a look today is made from, as the render cache keys it: a new way of making it is new. */
  readonly looksVersion: string;
  poll(taskId: string): Promise<PollResult>;
  /** Fetches a result, without the API key, retrying a stalled host. */
  download(url: string): Promise<DownloadResult>;
  /** The units left, summed across every pool, or null if they could not be read. */
  credits(): Promise<number | null>;
}

/** YouCam with its key; with none, the stub, which fakes YouCam's HTTP API. */
export function createImageProvider(
  apiKey: string | null,
  deps: { fetch: typeof fetch; now: () => Date; log: Logger; refsUrl: string },
): ImageProvider {
  const { log, refsUrl } = deps;
  if (apiKey !== null) return createYoucamProvider({ apiKey, fetch: deps.fetch, log, refsUrl });
  return createYoucamProvider({ apiKey: STUB_API_KEY, fetch: createStubYoucamFetch(deps.now), log, refsUrl });
}
