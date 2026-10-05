// Outside production, ?state=<arrival|served|unserved|booked|requested|expired|listed> opens a state of the landing
// directly, with the design's own pincodes and number, for the fidelity screenshots and the browser tests.

import { useEffect } from "preact/hooks";
import type { PincodeAnswer, ReferralConsultation } from "../../lib/api.ts";
import { indiaTomorrow } from "../../lib/dates.ts";
import type { Booking, Listing } from "./Done.tsx";

const PREVIEW_STATES = ["arrival", "served", "unserved", "booked", "requested", "expired", "listed"] as const;
type PreviewState = (typeof PREVIEW_STATES)[number];

const SAMPLE = {
  served: { pincode: "122018", served: true, area: "Sector 65", city: "Gurgaon" },
  unserved: { pincode: "400050", served: false, area: "Bandra", city: "Mumbai" },
  mobile: "98100 04417",
} satisfies Record<string, PincodeAnswer | string>;

/** A state's name from the address, if it is one. */
function previewNamed(name: string | null): PreviewState | undefined {
  return PREVIEW_STATES.find((state) => state === name);
}

/** The answer a ?state= preview of the confirmation opens with. */
function sampleBooking(state: "booked" | "requested" | "expired"): Booking {
  const result: ReferralConsultation = {
    state: state === "requested" ? "requested" : "booked",
    date: indiaTomorrow(),
    window: "morning",
    area: SAMPLE.served.area,
    credits: state !== "expired",
    invite: state === "expired" ? "expired" : "valid",
    one_visit: false,
  };
  return { result, mobile: SAMPLE.mobile, code: null };
}

/** What a preview opens the page on: a pincode's answer, or a confirmation. */
type Preview =
  | { readonly kind: "answer"; readonly answer: PincodeAnswer }
  | { readonly kind: "booked"; readonly booking: Booking }
  | { readonly kind: "listed"; readonly listing: Listing };

/** What each state opens with; the arrival is the page as it loads. */
function previewOf(state: PreviewState | undefined): Preview | null {
  if (state === undefined || state === "arrival") return null;
  if (state === "served") return { kind: "answer", answer: SAMPLE.served };
  if (state === "unserved") return { kind: "answer", answer: SAMPLE.unserved };
  if (state === "listed") {
    const { area, pincode } = SAMPLE.unserved;
    return { kind: "listed", listing: { area, credits: true, invite: "valid", pincode, alerted: true } };
  }
  return { kind: "booked", booking: sampleBooking(state) };
}

/** The preview the address asks for, opened once, only where previews are allowed (never in production). */
export function usePreview(allowed: boolean, open: (preview: Preview) => void): void {
  useEffect(() => {
    if (!allowed) return;
    const preview = previewOf(previewNamed(new URLSearchParams(location.search).get("state")));
    if (preview !== null) open(preview);
  }, [allowed]);
}
