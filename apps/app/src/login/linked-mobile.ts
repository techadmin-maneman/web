// The site's booking confirmation opens the app at /#mobile= and the ten digits typed there, so the login starts
// with the number filled in; the code is still asked for.

const LINKED = /^#mobile=([6-9]\d{9})$/;

/** The ten digits a link put after the #, or "" for none. */
export function mobileInLink(hash: string): string {
  return LINKED.exec(hash)?.[1] ?? "";
}

/** Whether the address carries a number for the login, which is taken off once read. */
export const carriesMobile = (hash: string): boolean => hash.startsWith("#mobile=");
