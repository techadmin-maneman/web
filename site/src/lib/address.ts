// The address a consultation is at, as the booking form holds it while it is typed and as the API takes it
// (docs/decisions/0081-the-site-takes-the-address.md). The parts, and which of them an address cannot do without,
// are the client app's; the pincode is the one the page has already checked, so it is never typed again.

import type { TypedAddress } from "./api.ts";

/** What the form holds: each part as typed, and the building chosen from the search with its search's session. */
export interface AddressFields {
  /** The building as chosen, or as typed into the search; line one where there is one. */
  building: string;
  /** Google's Place ID for the building chosen; empty for one typed. */
  placeId: string;
  /** One token for the whole search, sent with the booking, so Google bills one session. */
  session: string;
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

/** A new address, in the city of the pincode checked where we know it. */
export function emptyAddress(city: string | null): AddressFields {
  return {
    building: "",
    placeId: "",
    session: crypto.randomUUID(),
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

/** Whether a part is left out: line one is the building, where one was given. */
const leftOut = (address: AddressFields, part: RequiredPart): boolean =>
  part === "line1" && address.building.trim() !== "" ? false : address[part].trim() === "";

export function missingParts(address: AddressFields): RequiredPart[] {
  return REQUIRED.filter((part) => leftOut(address, part));
}

/** A required part as the API names it when it refuses it: "address.flat". */
const apiField = (part: RequiredPart): string => `address.${part}`;

/** The required parts, by the API's names. */
export const REQUIRED_API_FIELDS: readonly string[] = REQUIRED.map(apiField);

/** The required parts to mark: those left out once the form was checked, and those the API refused. */
export function partsToMark(address: AddressFields, checked: boolean, refused: readonly string[]): RequiredPart[] {
  return REQUIRED.filter((part) => (checked && leftOut(address, part)) || refused.includes(apiField(part)));
}

const orNone = (part: string): string | null => (part.trim() === "" ? null : part.trim());

/** The address as the API takes it, in the pincode checked. */
export function addressToSend(address: AddressFields, pincode: string): TypedAddress {
  const building = orNone(address.building);
  return {
    building,
    place_id: building === null ? null : orNone(address.placeId),
    session_token: address.session,
    flat: address.flat.trim(),
    floor: orNone(address.floor),
    tower: orNone(address.tower),
    line1: building ?? address.line1.trim(),
    line2: orNone(address.line2),
    landmark: orNone(address.landmark),
    locality: address.locality.trim(),
    city: address.city.trim(),
    pincode,
    access_notes: orNone(address.accessNotes),
  };
}
