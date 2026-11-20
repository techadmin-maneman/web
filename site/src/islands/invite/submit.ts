// What the landing's two forms (./Consultation.tsx, ./Waitlist.tsx) send by each door, and what follows once it is
// sent. The invite's page sends its own invite, and whether the friend was told who hears of the fit; the site's own
// page sends where the visit came from and the invite this browser remembers. Either way the
// invite the browser held is let go of once the form is sent.

import { track } from "../../lib/analytics.ts";
import { forgetInvite } from "../../lib/remembered-invite.ts";
import { readAttribution } from "../../lib/visit.ts";
import { codeInPath } from "./page.ts";

/** Which door the form is on, and what it holds that only one door sends. */
interface Door {
  /** On an invite's page, /r/:code; else the site's own /book. */
  readonly invited: boolean;
  /** The invite earns credits, so the form told the friend who hears of the fit. */
  readonly credits: boolean;
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
      ...(attribution === undefined ? {} : { attribution }),
      ...(door.remembered === null ? {} : { invite_code: door.remembered, invite_told: true as const }),
    },
  };
}

/**
 * Once sent: the invite this browser held let go of, and, on an invite's page, which has no first step of its own, the
 * lead reported. /book reported its lead when its first step was kept (./AboutYou.tsx).
 */
export function leadSent(door: Door): "invite" | "book" {
  const page = door.invited ? "invite" : "book";
  if (door.invited) track({ name: "generate_lead", page, event_id: crypto.randomUUID(), phone_hash: null });
  const invite = door.invited ? codeInPath() : door.remembered;
  if (invite !== null) forgetInvite(invite);
  return page;
}
