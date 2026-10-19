// When the hero film plays by itself, and which cut a screen gets. A visitor can always start it with Play.

import { MEDIA } from "@maneman/brand/breakpoints";

/** Screens this narrow get the phone cut, the film's upright centre (heroFootage.phoneVideo in content/site.ts). */
export const PHONE_SCREEN = MEDIA.phone;

/** What Chromium says of the visitor's connection (navigator.connection); other browsers say nothing. */
export interface Connection {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
}

/** The film plays by itself unless the visitor asked for reduced motion or less data, or is on a connection below 4G. */
export function playsByItself(reducedMotion: boolean, connection: Connection | undefined): boolean {
  if (reducedMotion) return false;
  if (connection === undefined) return true;
  if (connection.saveData === true) return false;
  return connection.effectiveType === undefined || connection.effectiveType === "4g";
}

/** A CSS time as a number of milliseconds: a browser gives back "3200ms" as "3.2s". NaN for anything else. */
export function milliseconds(time: string): number {
  const value = time.trim();
  if (value.endsWith("ms")) return parseFloat(value);
  if (value.endsWith("s")) return parseFloat(value) * 1000;
  return Number.NaN;
}
