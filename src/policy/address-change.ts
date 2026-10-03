// Where a client may move the address their visits go to, from the app. The technician goes to the address, so it must
// be somewhere we come; and a visit still to come is dispatched in its city, so while one is booked the address stays
// in that city. A client moving further asks ops, who move or cancel the visit first.

export const RULES = [
  "A client's address must be in a pincode we serve. One we do not serve, or do not know, is refused, and the client is offered the waitlist.",
  "While a visit is booked, the address may change only within the city that visit is in.",
] as const;

export type AddressRefusal = "not_served" | "visit_booked";

/** Why a client may not move their address to a pincode; null when they may. */
export function addressRefusal(change: {
  readonly served: boolean;
  /** The new pincode's city; null for a pincode we do not hold. */
  readonly city: string | null;
  /** The cities of the client's visits still to come. */
  readonly visitCities: readonly string[];
}): AddressRefusal | null {
  if (!change.served) return "not_served";
  if (change.visitCities.some((city) => city !== change.city)) return "visit_booked";
  return null;
}
