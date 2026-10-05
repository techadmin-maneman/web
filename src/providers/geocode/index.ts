// The address provider, behind an interface. Callers use GeocodeProvider; only
// this file knows which implementation runs, and only google-places.ts knows
// Google. The client profile's address routes are the only callers.
//
// Every call goes through our API. The browser never holds the key: the client
// app's policy is connect-src 'self', and a key in a page is a key anyone can
// spend (docs/decisions/0014-try-on-api.md made the same choice about R2).

import { createGooglePlaces } from "./google-places.ts";
import { createStubGeocodeFetch, STUB_API_KEY } from "./stub.ts";
import type { VendorFetchDependencies } from "../vendor-fetch.ts";

/** One line of the suggestion list. */
interface Suggestion {
  /** Google's Place ID. Exempt from their caching rule, so this is what we keep. */
  readonly placeId: string;
  /** The building, as the client will recognise it: "Sunrise Greens". */
  readonly primary: string;
  /** Where it is, beneath the name: "Sector 65, Gurugram". */
  readonly secondary: string;
}

/**
 * A coordinate and the address Google writes for it, both from the Geocoding
 * API and therefore ours to keep indefinitely (ADR 0054).
 */
interface ResolvedPlace {
  readonly placeId: string;
  readonly lat: number;
  readonly lng: number;
  readonly formattedAddress: string;
}

/**
 * Why a lookup gave nothing. The form never depends on the answer: a client can
 * always type the address instead, so a failure here costs suggestions, not the
 * address.
 */
export type LookupFailure =
  /** The provider could not be reached, or answered 5xx. Worth trying again. */
  | "unavailable"
  /** The key was refused or the quota is spent. Ops must act. */
  | "refused"
  /** Google knows no such place, or the Place ID has gone stale. */
  | "not_found";

export type SuggestResult =
  | { readonly ok: true; readonly suggestions: readonly Suggestion[] }
  | { readonly ok: false; readonly reason: LookupFailure; readonly detail: string };

export type ResolveResult =
  | { readonly ok: true; readonly place: ResolvedPlace }
  | { readonly ok: false; readonly reason: LookupFailure; readonly detail: string };

export interface GeocodeProvider {
  /**
   * Suggestions for what the client has typed so far. `sessionToken` groups
   * every keystroke and the resolve that follows into one billed session; see
   * resolve() for why it must be the same string throughout.
   */
  suggest(query: string, sessionToken: string): Promise<SuggestResult>;
  /**
   * The chosen building's coordinate. Closes the autocomplete session first,
   * then geocodes the Place ID, because only the Geocoding API's coordinates
   * may be kept (ADR 0054).
   */
  resolve(placeId: string, sessionToken: string): Promise<ResolveResult>;
}

/** Answers nothing, for an environment with no address provider. */
function createNoGeocode(): GeocodeProvider {
  const off = () => Promise.resolve({ ok: false, reason: "unavailable", detail: "no address provider here" } as const);
  return { suggest: off, resolve: off };
}

/** Google when there is a key; otherwise the stub, which fakes Google's HTTP API. */
export function createGeocodeProvider(
  provider: string | undefined,
  apiKey: string | null,
  deps: VendorFetchDependencies,
): GeocodeProvider {
  if (provider === "google" && apiKey !== null) return createGooglePlaces(apiKey, deps);
  if (provider === "stub") return createGooglePlaces(STUB_API_KEY, { fetch: createStubGeocodeFetch(), log: deps.log });
  return createNoGeocode();
}
