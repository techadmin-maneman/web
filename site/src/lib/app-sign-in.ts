// A visitor who has just booked, with a number the site proved, goes on into the client app signed in (ADR 0214). A
// number not proved is never signed in: whoever typed it may not hold it, so the booked screen's link to the app
// fills the number in and its code is still asked for.

import { mobileDigits } from "@maneman/web-kit/mobile";
import { signInWithProof } from "./api.ts";
import { clientAppOrigin, signedInLink } from "./app-link.ts";
import { ENVIRONMENT } from "./build.ts";
import { proofFor } from "./visitor.ts";

/**
 * Opens the app signed in for the number booked, as typed, where this tab proved it and the proof still holds; does
 * nothing for a number it did not, or where the app is not on.
 */
export async function goOnSignedIn(typedMobile: string): Promise<void> {
  const appOrigin = clientAppOrigin(ENVIRONMENT);
  const digits = mobileDigits(typedMobile);
  const proof = digits === null ? null : proofFor(digits);
  if (appOrigin === null || digits === null || proof === null) return;
  const answer = await signInWithProof(proof, digits);
  if (answer.ok) window.location.assign(signedInLink(appOrigin, answer.body.challenge_id, answer.body.code));
}
