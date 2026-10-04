// An invite's code (src/domain/referrals.ts makes one for each client): what the landing's link, the site's forms and
// the console accept as one, in either case. The site's landing path is built from it (site/src/lib/invite.ts).

/** A code's characters, as a pattern's source. */
export const INVITE_CODE = "[A-Za-z0-9]{4,12}";

/** A code on its own. */
export const CODE_PATTERN = new RegExp(`^${INVITE_CODE}$`);
