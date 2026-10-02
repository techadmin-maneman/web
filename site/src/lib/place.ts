// Where a booked visit is, as the confirmation names it (board C4).

import type { AddressFields } from "./address.ts";
import type { PincodeAnswer } from "./api.ts";

/** What was typed, or else what the pincode's answer gave. */
function typedOr(typed: string | undefined, given: string | null): string | null {
  const trimmed = typed?.trim() ?? "";
  return trimmed === "" ? given : trimmed;
}

const sameName = (one: string, other: string): boolean => one.toLowerCase() === other.toLowerCase();

/** "Sector 65, Gurgaon 122018", or "Noida 201301" where the area is the city: the city is never said twice. */
export function placeOf(answer: PincodeAnswer, typed?: Pick<AddressFields, "locality" | "city">): string {
  const area = typedOr(typed?.locality, answer.area);
  const city = typedOr(typed?.city, answer.city);
  const { pincode } = answer;
  if (area === null) return city === null ? pincode : `${city} ${pincode}`;
  if (city === null || sameName(area, city)) return `${area} ${pincode}`;
  return `${area}, ${city} ${pincode}`;
}
