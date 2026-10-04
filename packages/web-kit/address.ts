// A client's address as every app writes and checks it: the parts filled in, the one line it is written on, and the
// parts it is not one without (docs/decisions/0079-an-address-before-a-slot.md).

/** A part filled in. Absent and null mean the same: it was not. */
export const given = (part: string | null | undefined): part is string =>
  part !== null && part !== undefined && part.trim() !== "";

/** The parts an address is written from. A building chosen from the search is also its first line. */
export interface AddressParts {
  readonly flat?: string | null;
  readonly floor?: string | null;
  readonly tower?: string | null;
  readonly building?: string | null;
  readonly line1: string | null;
  readonly line2?: string | null;
  readonly locality: string;
  readonly city: string;
  readonly pincode: string;
}

/**
 * The address on one line, narrowest part first, as an envelope is written: the flat, the floor, the tower and the
 * building, then the street, the area, and the city with its pincode. A building that is also the first line is
 * written once, and an address saved before the flat and building fields existed reads as it did.
 */
export function addressLine(parts: AddressParts): string {
  const house = [parts.flat, parts.floor, parts.tower, parts.building, parts.line1, parts.line2].filter(given);
  return [...new Set(house), parts.locality, `${parts.city} ${parts.pincode}`].filter(given).join(", ");
}

export type RequiredPart = "flat" | "line1" | "locality" | "city" | "pincode";

/**
 * The parts an address is not one without, left out: the flat or house, the first line, the area, the city and a
 * six-digit pincode. The building search is an addition, never a gate: `line1` is the building where one was chosen,
 * so a client who used it is never asked for the same words twice.
 */
export function missingParts(address: AddressParts): RequiredPart[] {
  const left: RequiredPart[] = [];
  if (!given(address.flat)) left.push("flat");
  if (!given(address.line1)) left.push("line1");
  if (!given(address.locality)) left.push("locality");
  if (!given(address.city)) left.push("city");
  if (!/^\d{6}$/.test(address.pincode.trim())) left.push("pincode");
  return left;
}
