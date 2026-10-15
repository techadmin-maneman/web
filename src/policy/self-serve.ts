// The kinds of visit a client books, moves and cancels themselves (docs/decisions/0045-self-serve-booking.md): every
// kind while online payment is on, the free consultation alone while only it is, and none otherwise, when the app
// sends the client to WhatsApp and ops book for them.

import { VISIT_TYPES, type VisitType } from "../config/visit-types.ts";

export function selfServeKinds(settings: {
  readonly selfServeBooking: boolean;
  readonly selfServeConsultations: boolean;
}): readonly VisitType[] {
  if (settings.selfServeBooking) return VISIT_TYPES;
  return settings.selfServeConsultations ? ["consultation"] : [];
}
