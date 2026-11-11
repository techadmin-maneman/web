// The way to the door, and to the client once there (docs/decisions/0054-address-capture.md). Navigate's rule is the
// one the API's alerts use too (packages/web-kit/address.ts).

export { wayTo } from "@maneman/web-kit/address";

/** A call to the client, from the number on the card (E.164). */
export const callLink = (mobile: string): string => `tel:${mobile}`;
