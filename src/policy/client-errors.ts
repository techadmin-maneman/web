// Whether an error a page reports is our code's (docs/decisions/0277-alerts-that-come-sooner.md). A browser extension,
// or a script the browser or a proxy puts into the page, throws inside our pages too, and its stack names no script of
// ours: every frame is `<anonymous>`, or another origin's, as "chrome-extension://…". Those are kept out of Sentry's
// errors, so what Sentry holds as a client error is ours to fix.

import { ZONE_NAME } from "../config/environments.ts";

/** A stack's frame: a line naming where it ran, ending in its line and column. */
const FRAME = /:\d+:\d+\)?\s*$/;

/** A script of ours: served from our zone or a subdomain of it, or locally from a localhost. */
const OURS = new RegExp(`https?://(?:[a-z0-9-]+\\.)*(?:${ZONE_NAME.replace(".", "\\.")}|localhost)(?::\\d+)?/`, "i");

const isOurs = (text: string, origin: string): boolean => OURS.test(text) || text.includes(origin);

/**
 * Whether every frame of the report's stack ran outside our scripts; with no frames, whether the script it names is
 * another origin's. `origin` is the page's own, which counts as ours. A report naming nothing is taken as ours.
 */
export function isForeignError(report: { readonly stack?: string; readonly source?: string }, origin: string): boolean {
  const frames = (report.stack ?? "").split("\n").filter((line) => FRAME.test(line));
  if (frames.length > 0) return frames.every((frame) => !isOurs(frame, origin));
  const source = report.source ?? "";
  return source !== "" && !isOurs(source, origin);
}
