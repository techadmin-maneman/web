// When the hero film plays by itself, and which cut a screen gets. A visitor can always start it with Play.

/** Screens this narrow get the phone cut, the film's upright centre (heroFootage.phoneVideo in content/site.ts). */
export const PHONE_SCREEN = "(max-width: 600px)";

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
