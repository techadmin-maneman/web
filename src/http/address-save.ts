// A client's address saved, and the building search that finds its pin: by the
// client in the app, and by ops for a client who gives them it on the phone
// (docs/decisions/0054-address-capture.md, 0092-task-owners.md). One path for
// both, so an address ops record is saved as the client's own is: the building
// geocoded once, within the day's ceiling, and the address sent on to the
// client's Books customer and the CRM.

import type { Context } from "hono";
import type { AppEnv } from "./context.ts";
import { withinCeiling } from "../domain/platform/ceilings.ts";
import { saveAddress, type Address, type AddressPin, type GivenToOps } from "../domain/clients/profile.ts";
import { takeOne } from "../domain/sign-in/rate-limit.ts";
import type { LookupFailure } from "../providers/geocode/index.ts";
import { queueContactSync } from "./contact-sync.ts";
import { ALERT_WORDS } from "../config/alert-words.ts";

/**
 * Counts one Google request against the day's ceiling; false, with one alert a
 * day, once it is reached. Every call is counted, free SKU or not: the free
 * ones are free only while the session token does its work, and a ceiling that
 * assumed that would be no ceiling at all
 *.
 */
async function withinGeocodeCeiling(c: Context<AppEnv>, now: Date): Promise<boolean> {
  return withinCeiling(c.env.DB, c.var.deps.alert, "geocode", { now, settings: c.var.config.settings });
}

const GOOGLE_REFUSED = "google_refused";

/**
 * A lookup that failed is logged. One Google refused is ops' to put right — the
 * key, its APIs or its quota — and until then no address gets a pin, so they
 * are told, in Google's own words. The alert closes at the next lookup Google answers.
 */
async function lookupFailed(
  c: Context<AppEnv>,
  event: string,
  failure: { reason: LookupFailure; detail: string },
): Promise<void> {
  c.var.log.warn(event, { reason: failure.reason, detail: failure.detail });
  if (failure.reason !== "refused") return;
  await c.var.deps.alertOnce({
    key: GOOGLE_REFUSED,
    message: ALERT_WORDS.google_refused({ detail: failure.detail }),
  });
}

interface Suggestion {
  readonly place_id: string;
  readonly primary: string;
  readonly secondary: string;
}

/** The buildings Google suggests, or why there are none: busy, a ceiling reached; unavailable, Google failed. */
type Suggested =
  | { readonly ok: true; readonly suggestions: Suggestion[] }
  | { readonly ok: false; readonly code: "busy" | "unavailable" };

/**
 * What was typed, with the city of the pincode it is at: Google searches all of India, and "Galleria Road" alone put
 * a road in Meerut first for a client in Gurgaon. A pincode we do not know, or none, leaves it as typed.
 */
async function nearPincode(db: D1Database, q: string, pincode: string | undefined): Promise<string> {
  if (pincode === undefined) return q;
  const city = await db
    .prepare("SELECT city FROM serviceable_pincodes WHERE pincode = ?1")
    .bind(pincode)
    .first<string>("city");
  return city === null || q.toLowerCase().includes(city.toLowerCase()) ? q : `${q}, ${city}`;
}

/**
 * The buildings matching what was typed, `q`, in one billed session. Counted
 * first against the asker's day, `limitScope` and `asker` (a client, or a member
 * of staff), so one cannot spend the day's ceiling alone, then against the ceiling.
 */
export async function suggestBuildings(
  c: Context<AppEnv>,
  asking: {
    readonly limitScope: "address_suggest" | "ops_address_suggest" | "site_address_suggest";
    readonly asker: string;
    readonly q: string;
    readonly session: string;
    /** The pincode the address is at, where the form has it already: its city keeps the search near it. */
    readonly pincode?: string | undefined;
  },
): Promise<Suggested> {
  const now = c.var.deps.now();
  const within = await takeOne(c.env.DB, asking.limitScope, asking.asker, { now, settings: c.var.config.settings });
  if (!within || !(await withinGeocodeCeiling(c, now))) return { ok: false, code: "busy" };

  const answer = await c.var.deps.geocode.suggest(
    await nearPincode(c.env.DB, asking.q, asking.pincode),
    asking.session,
  );
  if (!answer.ok) {
    // The form carries on without suggestions: an address can always be typed.
    await lookupFailed(c, "address_suggest_failed", answer);
    return { ok: false, code: "unavailable" };
  }
  await c.var.deps.resolveAlert(GOOGLE_REFUSED);
  return {
    ok: true,
    suggestions: answer.suggestions.map((one) => ({
      place_id: one.placeId,
      primary: one.primary,
      secondary: one.secondary,
    })),
  };
}

/** A typed address as Google is asked to place it: its building, street and area, in that order. */
const typedLine = (address: Address): string =>
  [address.building, address.line1, address.locality, address.city]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(", ");

/** The building search's session, or a new one where none came with the address. */
const sessionOrNew = (token: string | null | undefined): string =>
  token === null || token === undefined || token === "" ? crypto.randomUUID() : token;

/**
 * The address's coordinate, geocoded once within the day's ceiling: a building's from its Place ID, a typed one's from
 * its words within its pincode where Google places it to the building. One Google could not place saves without a pin.
 */
export async function pinFor(
  c: Context<AppEnv>,
  address: Address,
  sessionToken: string | null | undefined,
): Promise<AddressPin | null> {
  if (!(await withinGeocodeCeiling(c, c.var.deps.now()))) return null;
  const { placeId } = address;
  const resolved =
    placeId === null
      ? await c.var.deps.geocode.locate(typedLine(address), address.pincode)
      : await c.var.deps.geocode.resolve(placeId, sessionOrNew(sessionToken));
  if (!resolved.ok && placeId === null && resolved.reason === "not_found") return null;
  if (!resolved.ok) {
    await lookupFailed(c, "address_resolve_failed", resolved);
    return null;
  }
  await c.var.deps.resolveAlert(GOOGLE_REFUSED);
  return { lat: resolved.place.lat, lng: resolved.place.lng, source: "google_geocoding" };
}

/**
 * Saves the address as the client's current one, and sends it on to their Books
 * customer and the CRM. A chosen building is geocoded here, once, and its coordinate kept.
 * A typed address has no Place ID and saves no pin: the geofence then measures
 * nothing rather than measuring zero (ADR 0036's honest degradation).
 */
export async function saveClientAddress(
  c: Context<AppEnv>,
  saving: {
    readonly personId: string;
    readonly address: Address;
    /** The session the building search ran in, which the Place Details call closes; none makes a new one. */
    readonly sessionToken: string | null | undefined;
    readonly givenToOps: GivenToOps | null;
  },
): Promise<void> {
  const { personId, address, sessionToken, givenToOps } = saving;
  const now = c.var.deps.now();
  const pin = await pinFor(c, address, sessionToken);
  await saveAddress(c.env.DB, { personId, address, pin, now, givenToOps });
  await queueContactSync(c, personId);
}

/**
 * A place ops chose from the building search, other than a client's address, as a technician's home is: its
 * coordinate and the address Google writes for it, geocoded once within the day's ceiling. Null where the ceiling is
 * reached or Google could not place it.
 */
export async function placeFor(
  c: Context<AppEnv>,
  placeId: string,
  sessionToken: string,
): Promise<{ readonly placeId: string; readonly label: string; readonly lat: number; readonly lng: number } | null> {
  if (!(await withinGeocodeCeiling(c, c.var.deps.now()))) return null;
  const resolved = await c.var.deps.geocode.resolve(placeId, sessionToken);
  if (!resolved.ok) {
    await lookupFailed(c, "place_resolve_failed", resolved);
    return null;
  }
  await c.var.deps.resolveAlert(GOOGLE_REFUSED);
  const { lat, lng, formattedAddress } = resolved.place;
  return { placeId, label: formattedAddress, lat, lng };
}
