// A finished render's image, fetched from wherever the provider left it, without the API key: a signed URL takes
// none, and must never be sent one. Each provider's adapter downloads through this.

import { MAX_RESULT_BYTES } from "../../config/tryon.ts";
import { inspectImage } from "../../lib/image-bytes.ts";
import type { DownloadResult } from "./index.ts";
import { vendorFetch, VendorUnreachable, type Vendor, type VendorFetchDependencies } from "../vendor-fetch.ts";

/** The result host stalls now and then; fail each try fast and try again. */
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_TIMEOUT_MS = 20_000;

/** A result no retry will make usable: too large for WhatsApp, or not an image at all. */
const unusable = (detail: string): DownloadResult => ({ ok: false, detail, transient: false });
/** A try the result host did not answer in full: worth another. */
const stalled = (detail: string): DownloadResult => ({ ok: false, detail, transient: true });

/** One try at a result: its bytes, a result no retry will make usable, or why this try failed. */
async function downloadOnce(http: VendorFetchDependencies, vendor: Vendor, url: string): Promise<DownloadResult> {
  const response = await vendorFetch(http, { vendor, step: "download", timeoutMs: DOWNLOAD_TIMEOUT_MS }, url);
  if (response instanceof VendorUnreachable) return stalled(response.reason);
  if (!response.ok) return stalled(`HTTP ${String(response.status)}`);

  // A result declared too large is refused before a byte of it is read.
  const declared = Number(response.headers.get("Content-Length") ?? "0");
  if (declared > MAX_RESULT_BYTES) {
    await response.body?.cancel();
    return unusable(`result is ${String(declared)} bytes`);
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    return stalled(error instanceof Error ? error.name : "error");
  }
  if (bytes.byteLength > MAX_RESULT_BYTES) return unusable(`result is ${String(bytes.byteLength)} bytes`);
  const info = inspectImage(bytes);
  if (info === null) return unusable("result is not a JPEG or PNG");
  return { ok: true, bytes, contentType: info.type };
}

/** The result's bytes, tried a few times over a stalled host; `scrub` takes the key out of what is said. */
export async function downloadResult(
  http: VendorFetchDependencies,
  { vendor, url, scrub }: { vendor: Vendor; url: string; scrub: (text: string) => string },
): Promise<DownloadResult> {
  if (!url.startsWith("https://")) return unusable("result URL is not https");
  let last = "";
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    const tried = await downloadOnce(http, vendor, url);
    if (tried.ok || !tried.transient) return tried;
    last = tried.detail;
  }
  return {
    ok: false,
    detail: scrub(`download failed after ${String(DOWNLOAD_ATTEMPTS)} tries: ${last}`),
    transient: true,
  };
}
