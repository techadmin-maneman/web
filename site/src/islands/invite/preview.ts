// Outside production, ?state=<arrival|served|unserved|booked|requested|expired|listed> opens a state of the landing
// directly, with the design's own pincodes and number, for the fidelity screenshots and the browser tests.

import type { PincodeAnswer, ReferralConsultation } from "../../lib/api.ts";
import { indiaTomorrow } from "../../lib/dates.ts";
import { placeOf, type Booking } from "./Done.tsx";

const PREVIEW_STATES = ["arrival", "served", "unserved", "booked", "requested", "expired", "listed"] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];

export const SAMPLE = {
  served: { pincode: "122018", served: true, area: "Sector 65", city: "Gurgaon" },
  unserved: { pincode: "400050", served: false, area: "Bandra", city: "Mumbai" },
  mobile: "98100 04417",
} satisfies Record<string, PincodeAnswer | string>;

/** A state's name from the address, if it is one. */
export function previewNamed(name: string | null): PreviewState | undefined {
  return PREVIEW_STATES.find((state) => state === name);
}

/** The answer a ?state= preview of the confirmation opens with. */
export function sampleBooking(state: "booked" | "requested" | "expired"): Booking {
  const result: ReferralConsultation = {
    state: state === "requested" ? "requested" : "booked",
    date: indiaTomorrow(),
    window: "morning",
    area: SAMPLE.served.area,
    credits: state !== "expired",
    invite: state === "expired" ? "expired" : "valid",
    address: "saved",
    first_fit: false,
  };
  return { result, mobile: SAMPLE.mobile, place: placeOf(SAMPLE.served) };
}
