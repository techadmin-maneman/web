// A visitor who has just booked, with a number the site proved, goes on into the client app signed in (ADR 0214). A
// number not proved is never signed in: whoever typed it may not hold it, so the booked screen's link to the app
// fills the number in and its code is still asked for.

import { signInWithProof } from "./api.ts";
import { clientAppOrigin, signedInLink } from "./app-link.ts";
import { ENVIRONMENT } from "./build.ts";

/** Opens the app signed in where the proof still holds; does nothing where it does not, or the app is not on. */
export async function goOnSignedIn(digits: string, proof: string | null): Promise<void> {
  const appOrigin = clientAppOrigin(ENVIRONMENT);
  if (appOrigin === null || proof === null) return;
  const answer = await signInWithProof(proof, digits);
  if (answer.ok) window.location.assign(signedInLink(appOrigin, answer.body.challenge_id, answer.body.code));
}
