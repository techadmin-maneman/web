// Who did something, as the console shows them: a member of staff by their
// e-mail, and a service token as one, never by its 40-character ID.

import { shell } from "../content.ts";

export const whoWords = (who: string): string => (who.includes("@") ? who : shell.serviceToken);
