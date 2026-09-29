// A client's address saved, and the building search that finds its pin: by the
// client in the app, and by ops for a client who gives them it on the phone
// (docs/decisions/0054-address-capture.md, 0092-task-owners.md). One path for
// both, so an address ops record is saved as the client's own is: the building
// geocoded once, within the day's ceiling, and the address sent on to FSM's
// contact and the CRM.

import type { Context } from "hono";
import type { AppEnv } from "./context.ts";
import { alertCeilingReached, takeFromCeiling } from "../domain/ceilings.ts";
import { saveAddress, type Address, type AddressPin, type GivenToOps } from "../domain/profile.ts";
import { takeOne } from "../domain/rate-limit.ts";
import { indiaDate } from "../lib/india-time.ts";
import type { LookupFailure } from "../providers/geocode.ts";
import { queueContactSync } from "./contact-sync.ts";

/** Suggestions one asker may have in a day, so one cannot spend the global ceiling. */
const SUGGESTIONS_PER_DAY = 120;

/**
 * Counts one Google request against the day's ceiling; false, with one alert a
 * day, once it is reached. Every call is counted, free SKU or not: the free
 * ones are free only while the session token does its work, and a ceiling that
 * assumed that would be no ceiling at all
 * (docs/decisions/0054-address-capture.md).
 */
async function withinGeocodeCeiling(c: Context<AppEnv>, now: Date): Promise<boolean> {
  const ceiling = c.var.config.settings.geocode.dailyCeiling;
  if (await takeFromCeiling(c.env.DB, "geocode", ceiling, now)) return true;
  await alertCeilingReached(c.env.DB, c.var.deps.alert, "geocode", ceiling, now);
  return false;
}

/**
 * A lookup that failed is logged. One Google refused is ops' to put right — the
 * key, its APIs or its quota — and until then no address gets a pin, so they
 * are told, once a day while it lasts, in Google's own words.
 */
async function lookupFailed(
  c: Context<AppEnv>,
  event: string,
  failure: { reason: LookupFailure; detail: string },
): Promise<void> {
  c.var.log.warn(event, { reason: failure.reason, detail: failure.detail });
  if (failure.reason !== "refused") return;
  await c.var.deps.alertOnce({
    key: `google_refused:${indiaDate(c.var.deps.now())}`,
    message:
      `Google refused the address search (${failure.detail}). Clients can still type an address, but none gets ` +
      "a pin. Check the key, its APIs and its quotas (runbook, section 13).",
  });
}

export interface Suggestion {
  readonly place_id: string;
  readonly primary: string;
  readonly secondary: string;
}

/** The buildings Google suggests, or why there are none: busy, a ceiling reached; unavailable, Google failed. */
export type Suggested =
  | { readonly ok: true; readonly suggestions: Suggestion[] }
  | { readonly ok: false; readonly code: "busy" | "unavailable" };

/**
 * The buildings matching what was typed, `q`, in one billed session. Counted
 * first against the asker's day, `limitScope` and `asker` (a client, or a member
 * of staff), so one cannot spend the day's ceiling alone, then against the ceiling.
 */
export async function suggestBuildings(
  c: Context<AppEnv>,
  asking: { readonly limitScope: string; readonly asker: string; readonly q: string; readonly session: string },
): Promise<Suggested> {
  const now = c.var.deps.now();
  const within = await takeOne(c.env.DB, {
    scope: asking.limitScope,
    key: asking.asker,
    window: indiaDate(now),
    limit: SUGGESTIONS_PER_DAY,
  });
  if (!within || !(await withinGeocodeCeiling(c, now))) return { ok: false, code: "busy" };

  const answer = await c.var.deps.geocode.suggest(asking.q, asking.session);
  if (!answer.ok) {
    // The form carries on without suggestions: an address can always be typed.
    await lookupFailed(c, "address_suggest_failed", answer);
    return { ok: false, code: "unavailable" };
  }
  return {
    ok: true,
    suggestions: answer.suggestions.map((one) => ({
      place_id: one.placeId,
      primary: one.primary,
      secondary: one.secondary,
    })),
  };
}

/** The building search's session, or a new one where none came with the address. */
const sessionOrNew = (token: string | null | undefined): string =>
  token === null || token === undefined || token === "" ? crypto.randomUUID() : token;

/**
 * Saves the address as the client's current one, and sends it on to FSM's contact
 * and the CRM. A chosen building is geocoded here, once, and its coordinate kept.
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
  let pin: AddressPin | null = null;
  if (address.placeId !== null && (await withinGeocodeCeiling(c, now))) {
    const resolved = await c.var.deps.geocode.resolve(address.placeId, sessionOrNew(sessionToken));
    if (resolved.ok) pin = { lat: resolved.place.lat, lng: resolved.place.lng, source: "google_geocoding" };
    else await lookupFailed(c, "address_resolve_failed", resolved);
  }

  await saveAddress(c.env.DB, { personId, address, pin, now, givenToOps });
  await queueContactSync(c, personId);
}
