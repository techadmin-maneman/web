// The address a consultation is at, as the booking form holds it while it is typed and as the API takes it
// (docs/decisions/0081-the-site-takes-the-address.md). The parts, and which of them an address cannot do without,
// are the client app's; the pincode is the one the page has already checked, so it is never typed again.

import type { TypedAddress } from "./api.ts";
import { isOneOf } from "../../../src/lib/one-of.ts";

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
const REQUIRED = ["flat", "line1", "locality", "city"] as const;
export type RequiredPart = (typeof REQUIRED)[number];

export function isRequiredPart(part: keyof AddressFields): part is RequiredPart {
  return isOneOf(REQUIRED, part);
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

/** A required part as the API names it when it refuses it: "address.flat". */
const apiField = (part: RequiredPart): string => `address.${part}`;

/** The required parts, by the API's names. */
export const REQUIRED_API_FIELDS: readonly string[] = REQUIRED.map(apiField);

/** The required parts to mark: those left out once the form was checked, and those the API refused. */
export function partsToMark(address: AddressFields, checked: boolean, refused: readonly string[]): RequiredPart[] {
  return REQUIRED.filter((part) => (checked && address[part].trim() === "") || refused.includes(apiField(part)));
}

const orNone = (part: string): string | null => (part.trim() === "" ? null : part.trim());

/** The address as the API takes it, in the pincode checked. */
export function addressToSend(address: AddressFields, pincode: string): TypedAddress {
  return {
    flat: address.flat.trim(),
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
