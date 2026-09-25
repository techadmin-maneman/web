// The way to the door (docs/decisions/0054-address-capture.md), and to the
// client once there.
//
// The card linked `geo:0,0?q=<the typed address>` until the owner ruled open
// point 27 on 24 September 2026: any phone, including iPhones. Android hands a
// `geo:` link to a map app; iOS Safari does not register the scheme at all, so
// on an iPhone the button did nothing and said nothing either.
//
// Google's Maps URLs replace it. They need no key, carry no SKU, sit outside
// the Maps Platform contract, and open on both platforms. `api=1` is required,
// and the only stated limit is 2,048 characters, which an address in six short
// parts cannot reach.

// The schema rather than ./api.ts, so the rule can be read and tested in Node
// without the fetch client coming with it (test/node/tech-navigate.test.ts).
import type { components } from "../api-schema.ts";

type Address = NonNullable<components["schemas"]["TechnicianJobDetail"]["address"]>;

/** A part the client filled in. */
const given = (part: string | null): part is string => part !== null && part.trim() !== "";

/**
 * The address on one line, narrowest part first, as the client app writes it
 * (apps/app/src/profile/AddressSection.tsx): the flat, the floor, the tower and
 * the building, then the street, the area and the city. A building chosen from
 * the search is also the first line, and is written once.
 */
export function addressLine(parts: Address): string {
  const house = [parts.flat, parts.floor, parts.tower, parts.building, parts.line1, parts.line2].filter(given);
  return [...new Set(house), parts.locality, `${parts.city} ${parts.pincode}`].filter(given).join(", ");
}

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

/** WhatsApp's own link to a number, which takes the digits alone. */
export const whatsAppLink = (mobile: string): string => `https://wa.me/${mobile.replace(/\D/g, "")}`;
