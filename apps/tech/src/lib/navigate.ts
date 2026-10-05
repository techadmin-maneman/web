// The way to the door, and to the client once there (docs/decisions/0054-address-capture.md). Navigate opens Google's
// Maps URLs, which need no key and open on any phone: an iPhone registers no `geo:` link. `api=1` is required, and
// the one stated limit, 2,048 characters, is beyond an address in six short parts.

// The schema rather than ./api.ts, so the rule can be read and tested in Node
// without the fetch client coming with it (test/node/tech-navigate.test.ts).
import { given } from "@maneman/web-kit/address";
import type { components } from "../api-schema.ts";

type Address = NonNullable<components["schemas"]["TechnicianJobDetail"]["address"]>;

/** What a map is asked for when there is no pin: the building and the area. A flat number only confuses it. */
function placeOf(parts: Address): string {
  const building = given(parts.building) ? parts.building : parts.line1;
  return [building, parts.line2, parts.locality, `${parts.city} ${parts.pincode}`].filter(given).join(", ");
}

/**
 * Where Navigate goes: the address's own pin when it has one, because a
 * coordinate is the door rather than a map's reading of a sentence; the typed
 * address when it has none, which is every address saved before ADR 0054 and
 * every one typed rather than chosen.
 */
export function wayTo(address: Address): string {
  const pin = address.lat !== null && address.lng !== null ? `${String(address.lat)},${String(address.lng)}` : null;
  const destination = pin ?? placeOf(address);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/** A call to the client, from the number on the card (E.164). */
export const callLink = (mobile: string): string => `tel:${mobile}`;
