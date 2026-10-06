// What the hourly passes to Books share: how much a run takes, how often a record is looked at again, and how a
// failure reaches ops. Books' own refusal is told at once, in its words; any other failure on its third time, an hour
// apart, since one alone is often the network.

import { HOUR_MS } from "../../lib/durations.ts";
import type { Logger } from "../../log.ts";
import { isRefusal } from "../../providers/provider-error.ts";
import type { AlertOnce } from "../ops/alerts.ts";

/** How many records of each kind a pass takes at most; the next run takes the rest. */
export const PER_PASS = 5;
export const RECHECK_AFTER_MS = HOUR_MS;
/** A failure other than a refusal is told once it has happened this many times, an hour apart. */
export const FAILURES_BEFORE_ALERT = 3;

/** One record a pass could not write, as the log and ops are told of it. */
interface PassFailure {
  /** What the log's events and the alerts' keys call it: "invoice", "books_customer". */
  readonly event: string;
  readonly id: string;
  /** The log field its ID goes under. */
  readonly idField: string;
  /** Where ops act on it. */
  readonly link: string;
  /** The alert's words for Books' refusal, which quote what Books said. */
  readonly refused: (said: string) => string;
  /** The alert's words for any other failure. */
  readonly failed: (error: unknown) => string;
}

/** Logs the failure, and tells ops of a refusal at once and of any other failure on its third time. */
export async function tellFailure(
  pass: { readonly log: Logger; readonly deps: { readonly alertOnce: AlertOnce } },
  failure: PassFailure,
  error: unknown,
): Promise<void> {
  const { event, id, idField, link } = failure;
  if (isRefusal(error)) {
    pass.log.warn(`${event}_refused`, { [idField]: id, status: error.status, code: error.code });
    await pass.deps.alertOnce({ key: `${event}_refused:${id}`, message: failure.refused(error.said), link });
    return;
  }
  pass.log.warn(`${event}_failed`, { [idField]: id, error });
  await pass.deps.alertOnce({
    key: `${event}_failed:${id}`,
    message: failure.failed(error),
    link,
    after: FAILURES_BEFORE_ALERT,
  });
}
