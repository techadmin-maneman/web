// What booking says of photographs (docs/decisions/0080-consents-given-by-booking.md): every visit is photographed
// for the client's record, which the pay step says beneath Pay, and booking agrees to no consent. Referral cards are
// the client's choice when they first share an invite (../refer/ShareSheet.tsx). An earlier build asked for both at
// booking, and the API still records what such a build showed, on the notice of the lines it showed.

import { booking } from "../content.ts";

/** The pay step's line on photographs, beneath Pay. */
export const photoLine = (): string => booking.pay.photos.line;
