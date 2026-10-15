// A client's address as every app writes and checks it: the parts filled in, the one line it is written on, the
// parts it is not one without (docs/decisions/0079-an-address-before-a-slot.md), and the fields every form asks for.

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
 * building, then the street, the area, and the city with its pincode. Words already written are written once, as a
 * building that is also the first line, or an area a client typed into the street ("Nirvana Country, Sector 50" in
 * Sector 50); an address saved before the flat and building fields existed reads as it did.
 */
export function addressLine(parts: AddressParts): string {
  const house = [parts.flat, parts.floor, parts.tower, parts.building, parts.line1, parts.line2];
  const pieces = [...house, parts.locality, `${parts.city} ${parts.pincode}`]
    .filter(given)
    .flatMap((part) => part.split(",").map((piece) => piece.trim()))
    .filter((piece) => piece !== "");
  const seen = new Set<string>();
  return pieces
    .filter((piece) => {
      const key = piece.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
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

/** A part a form asks for, by the API's name. */
export type AddressPart =
  "flat" | "floor" | "tower" | "line1" | "line2" | "landmark" | "locality" | "city" | "pincode" | "access_notes";

/** A part as every form asks for it. */
export interface AddressField {
  readonly part: AddressPart;
  readonly maxLength?: number;
  readonly required?: boolean;
  /** Folded away beneath the flat until asked for, where the form folds. */
  readonly folded?: boolean;
  readonly autoComplete?: string;
  readonly inputMode?: "numeric";
}

/**
 * The parts in the order every form asks for them, each with the API's longest (src/routes/schemas/address.ts) and what
 * a browser may fill it from.
 */
export const ADDRESS_FIELDS: readonly AddressField[] = [
  { part: "flat", maxLength: 40, required: true },
  { part: "floor", maxLength: 20, folded: true },
  { part: "tower", maxLength: 40, folded: true },
  { part: "line1", maxLength: 120, required: true, autoComplete: "address-line1" },
  { part: "line2", maxLength: 120, autoComplete: "address-line2" },
  { part: "landmark", maxLength: 120, folded: true },
  { part: "locality", maxLength: 80, required: true, autoComplete: "address-level3" },
  { part: "city", maxLength: 40, required: true, autoComplete: "address-level2" },
  { part: "pincode", required: true, autoComplete: "postal-code", inputMode: "numeric" },
  { part: "access_notes", maxLength: 300 },
];
