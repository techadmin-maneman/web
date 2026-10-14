// Who did something, as the console shows them: a member of staff by their
// e-mail, and a service token as one, never by its 40-character ID.

import { shell } from "../content.ts";

export const whoWords = (who: string): string => (who.includes("@") ? who : shell.serviceToken);

/** "priya.sharma@maneman.in" is ["priya", "sharma"]: the parts of the name before the @. */
export const nameParts = (email: string): string[] =>
  (email.split("@")[0] ?? email).split(/[._-]+/).filter((part) => part !== "");

/** One who recorded something: a service token the Staff list has no label for as one, never by its ID. */
export const recordedBy = (who: string): string => (who.endsWith(".access") ? shell.serviceToken : who);
