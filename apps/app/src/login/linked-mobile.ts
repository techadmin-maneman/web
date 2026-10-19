// What the site opens the app with, after the #: the ten digits typed there (/#mobile=), so the login starts with the
// number filled in and its code still asked for; or, for a number the site proved, a sign-in it handed over
// (/#signin=), which the app finishes at once (ADR 0214).

const LINKED = /^#mobile=([6-9]\d{9})$/;
const SIGN_IN = /^#signin=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{6})$/;

/** A sign-in the site handed over: the challenge, and the code that finishes it. */
export interface LinkedSignIn {
  readonly challengeId: string;
  readonly code: string;
}

/** The ten digits a link put after the #, or "" for none. */
export function mobileInLink(hash: string): string {
  return LINKED.exec(hash)?.[1] ?? "";
}

/** The sign-in a link put after the #, or null for none. */
export function signInInLink(hash: string): LinkedSignIn | null {
  const found = SIGN_IN.exec(hash);
  if (found?.[1] === undefined || found[2] === undefined) return null;
  return { challengeId: found[1], code: found[2] };
}

/** Whether the address carries a number or a sign-in for the login, which is taken off once read. */
export const carriesLogin = (hash: string): boolean => hash.startsWith("#mobile=") || hash.startsWith("#signin=");

/** What the app was opened with for its login: the number to fill in, and a sign-in to finish at once. */
export interface LinkedLogin {
  readonly mobile: string;
  readonly signIn: LinkedSignIn | null;
}
