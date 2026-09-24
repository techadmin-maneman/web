// The way to the door (docs/decisions/0054-address-capture.md).
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

/** The address as one line, from the parts the API keeps it in. */
export function addressLine(parts: Address): string {
  return [parts.line1, parts.line2, parts.locality, `${parts.city} ${parts.pincode}`]
    .filter((part) => part !== null && part.trim() !== "")
    .join(", ");
}

/**
 * Where Navigate goes: the address's own pin when it has one, because a
 * coordinate is the door rather than a map's reading of a sentence; the typed
 * address when it has none, which is every address saved before ADR 0054 and
 * every one typed rather than chosen.
 */
export function wayTo(address: Address): string {
  const pin = address.lat !== null && address.lng !== null ? `${String(address.lat)},${String(address.lng)}` : null;
  const destination = pin ?? addressLine(address);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
