// The invite as GET /api/r/:code answers it, shared by the mm-site Worker, which writes it into the page, and the
// landing's island, which reads it back. Neither trusts an answer it cannot read: an invite that fails the check is
// treated as one that did not arrive, and the island asks for it again.

import { HOUSE_CARD, HOUSE_CARD_VERSION } from "../../../src/config/house-card.ts";
import type { Invite } from "./api.ts";

/** The house card, with its version, which the API's preview redirects to as well (src/config/house-card.ts). */
export { HOUSE_CARD, HOUSE_CARD_VERSION };

/** Every state the API can answer. Listing them as keys makes a new state in the contract a type error here. */
const STATES = { valid: true, unknown: true } satisfies Record<Invite["state"], true>;
const CARD_STATES = { house: true, personal: true } satisfies Record<Invite["card"]["state"], true>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isInvite(value: unknown): value is Invite {
  if (!isRecord(value) || !isRecord(value.card)) return false;
  const name = value.referrer_first_name;
  return (
    typeof value.state === "string" &&
    Object.hasOwn(STATES, value.state) &&
    (name === null || typeof name === "string") &&
    typeof value.card.state === "string" &&
    Object.hasOwn(CARD_STATES, value.card.state) &&
    Number.isInteger(value.card.version)
  );
}

/** The invite's card as a path on the site: the referrer's own while it is live, else the house card. */
export function cardPath(invite: Invite, code: string): string {
  if (invite.card.state !== "personal" || code === "") return HOUSE_CARD;
  return `/api/og/${code}.jpg?v=${String(invite.card.version)}`;
}
