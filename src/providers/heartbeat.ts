// The cron's heartbeat to an outside monitor, a healthchecks.io check: pinged after every run, at its URL when every
// job worked and at the URL with /fail when one failed. Every other alert is sent from inside mm-api, so a cron that
// stops running altogether tells nobody; the monitor tells the alert space when the pings stop. Posting must never
// break the run, so failures are logged, not thrown.

import type { Logger } from "../log.ts";
import { vendorFetch, VendorUnreachable } from "./vendor-fetch.ts";

const TIMEOUT_MS = 5_000;

export interface HeartbeatOptions {
  /** HEARTBEAT_URL; none sends nothing. */
  readonly url: string | null;
  readonly fetch: typeof fetch;
  readonly log: Logger;
}

/** The ping's body names the jobs that failed, which the monitor keeps beside the ping. */
export async function pingHeartbeat(options: HeartbeatOptions, failedJobs: readonly string[]): Promise<void> {
  const { url, fetch, log } = options;
  if (url === null) return;

  const target = failedJobs.length === 0 ? url : `${url}/fail`;
  const call = { vendor: "healthchecks", step: "heartbeat", timeoutMs: TIMEOUT_MS } as const;
  const response = await vendorFetch({ fetch, log }, call, target, { method: "POST", body: failedJobs.join(", ") });
  if (response instanceof VendorUnreachable) {
    log.error("heartbeat_not_delivered", { error: response });
    return;
  }
  if (!response.ok) log.error("heartbeat_not_delivered", { status: response.status });
}
