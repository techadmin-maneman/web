// Who did something, as the console shows them: a member of staff by their
// e-mail, and anything automatic as System, never by a token's ID or label.

import { shell } from "../content.ts";

export const whoWords = (who: string): string => (who.includes("@") ? who : shell.serviceToken);

/** "priya.sharma@maneman.in" is ["priya", "sharma"]: the parts of the name before the @. */
export const nameParts = (email: string): string[] =>
  (email.split("@")[0] ?? email).split(/[._-]+/).filter((part) => part !== "");

/** "priya.sharma@maneman.in" is "Priya Sharma": a member of staff by name, where the console has only their e-mail. */
export const staffName = (email: string): string =>
  nameParts(email)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || email;

/** One who recorded something: a person by their e-mail, and a token, however the Staff list labels it, as System. */
export const recordedBy = (who: string): string =>
  who.includes("@") && !who.endsWith(".access") ? who : shell.serviceToken;
