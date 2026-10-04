// What the landing's two forms (./Consultation.tsx, ./Waitlist.tsx) send by each door, and what follows once it is
// sent. The invite's page sends its own invite, and whether the friend was told who hears of the fit; the site's own
// page sends where the visit came from, where the hair loss is, and the invite this browser remembers. Either way the
// lead is reported once, with the page it came through, and the invite the browser held is let go of.

import type { LossExtent } from "../../../../src/config/booking.ts";
import { track } from "../../lib/analytics.ts";
import type { BookingWindow } from "../../../../src/config/scheduling.ts";
import { forgetInvite } from "../../lib/remembered-invite.ts";
import { readAttribution } from "../../lib/visit.ts";
import { codeInPath } from "./page.ts";

/** Which door the form is on, and what it holds that only one door sends. */
export interface Door {
  /** On an invite's page, /r/:code; else the site's own /book. */
  readonly invited: boolean;
  /** The invite earns credits, so the form told the friend who hears of the fit. */
  readonly credits: boolean;
  readonly extent: LossExtent | null;
  /** On /book, the invite this browser remembers, once the form has said who is told of the fit. */
  readonly remembered: string | null;
}

/** The request each door sends: the invite's page's, and the site's own. */
export function byDoor<R extends object>(request: R, door: Door) {
  const attribution = readAttribution();
  return {
    onInvite: { ...request, ...(door.credits ? { invite_told: true as const } : {}) },
    onBook: {
      ...request,
      ...(door.extent === null ? {} : { loss_extent: door.extent }),
      ...(attribution === undefined ? {} : { attribution }),
      ...(door.remembered === null ? {} : { invite_code: door.remembered, invite_told: true as const }),
    },
  };
}

/** Once sent: the lead reported with the page it came through, and the invite this browser held let go of. */
export function leadSent(
  door: Door,
  lead: { readonly served: boolean; readonly area: string | null; readonly window: BookingWindow | null },
): "invite" | "book" {
  const page = door.invited ? "invite" : "book";
  track({ name: "lead_submitted", page, ...lead, loss_extent: door.invited ? null : door.extent });
  const invite = door.invited ? codeInPath() : door.remembered;
  if (invite !== null) forgetInvite(invite);
  return page;
}
