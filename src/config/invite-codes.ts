// An invite's code (src/domain/referrals.ts makes one for each client): what the landing's link, the site's forms and
// the console accept as one, in either case, and the landing's own path, /r/ and the code.

const CODE = "[A-Za-z0-9]{4,12}";

/** A code on its own. */
export const CODE_PATTERN = new RegExp(`^${CODE}$`);

/** An invite's landing, the code captured: "/r/MM4417" or "/r/MM4417/". */
export const INVITE_PATH = new RegExp(`^/r/(${CODE})/?$`);

/** An invite's landing within a whole address, so the code can be taken out of what is reported. */
export const INVITE_PATH_IN_URL = new RegExp(`/r/${CODE}/?(?=[?#]|$)`);
