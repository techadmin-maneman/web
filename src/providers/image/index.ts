// The image provider, behind an interface. Callers use ImageProvider; only
// this file knows which implementation runs, and only ailabtools.ts knows
// AILabTools. The render consumer is the only caller.

import type { Endpoint, Preset } from "../../config/presets.ts";
import type { FailureCode, HairColor } from "../../config/tryon.ts";
import type { ImageType } from "../../lib/image-bytes.ts";
import type { Logger } from "../../log.ts";
import { createAilabtoolsProvider } from "./ailabtools.ts";
import { createStubAilabtoolsFetch, STUB_API_KEY } from "./stub.ts";

/** The colour sent to the provider: a natural shade, or Premium's "keep the original". */
export type ProviderColor = Exclude<HairColor, "unknown"> | "original";

export interface RenderFailure {
  /** What the customer's page is told. */
  readonly code: Exclude<FailureCode, "busy">;
  /** Worth trying again: a timeout, a 5xx or a 429. A refused photo is not. */
  readonly transient: boolean;
  /** Ops must act: the key was refused, the credits ran out, or the endpoint is gone. */
  readonly alert: boolean;
  /** For D1 and the logs, with the API key scrubbed out. Never shown to the customer. */
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
  submit(image: Uint8Array, preset: Preset, color: ProviderColor, endpoint: Endpoint): Promise<SubmitResult>;
  poll(taskId: string, endpoint: Endpoint): Promise<PollResult>;
  /** Fetches a result, without the API key, retrying a stalled CDN. */
  download(url: string): Promise<DownloadResult>;
  /** The balance summed across every credit pool, or null if it could not be read. */
  credits(): Promise<number | null>;
}

/** The real provider when there is an API key; otherwise the stub, which fakes AILabTools' HTTP API. */
export function createImageProvider(
  apiKey: string | null,
  deps: { fetch: typeof fetch; now: () => Date; log: Logger },
): ImageProvider {
  if (apiKey !== null) return createAilabtoolsProvider({ apiKey, fetch: deps.fetch, log: deps.log });
  return createAilabtoolsProvider({ apiKey: STUB_API_KEY, fetch: createStubAilabtoolsFetch(deps.now), log: deps.log });
}
