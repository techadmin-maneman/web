// The address a consultation is at, as the booking form holds it while it is typed and as the API takes it
// (docs/decisions/0081-the-site-takes-the-address.md). The parts, and which of them an address cannot do without,
// are the client app's; the pincode is the one the page has already checked, so it is never typed again.

import type { TypedAddress } from "./api.ts";

/** What the form holds: each part as typed. */
export interface AddressFields {
  flat: string;
  floor: string;
  tower: string;
  line1: string;
  line2: string;
  landmark: string;
  locality: string;
  city: string;
  accessNotes: string;
}

/** The parts an address is not one without, in the order the form asks for them. */
const REQUIRED = ["line1", "locality", "city"] as const;
export type RequiredPart = (typeof REQUIRED)[number];

export function isRequiredPart(part: keyof AddressFields): part is RequiredPart {
  return (REQUIRED as readonly string[]).includes(part);
}

/** A new address, in the city of the pincode checked where we know it. */
export function emptyAddress(city: string | null): AddressFields {
  return {
    flat: "",
    floor: "",
    tower: "",
    line1: "",
    line2: "",
    landmark: "",
    locality: "",
    city: city ?? "",
    accessNotes: "",
  };
}

export function missingParts(address: AddressFields): RequiredPart[] {
  return REQUIRED.filter((part) => address[part].trim() === "");
}

const orNone = (part: string): string | null => (part.trim() === "" ? null : part.trim());

/** The address as the API takes it, in the pincode checked. */
export function addressToSend(address: AddressFields, pincode: string): TypedAddress {
  return {
    flat: orNone(address.flat),
    floor: orNone(address.floor),
    tower: orNone(address.tower),
    line1: address.line1.trim(),
    line2: orNone(address.line2),
    landmark: orNone(address.landmark),
    locality: address.locality.trim(),
    city: address.city.trim(),
    pincode,
    access_notes: orNone(address.accessNotes),
  };
}
