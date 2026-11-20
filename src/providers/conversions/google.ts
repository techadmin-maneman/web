// Google's Data Manager API (docs/decisions/0288-attribution-and-conversions.md), which has carried Google Ads'
// offline conversions and enhanced conversions for leads since 2026: one event a request to events:ingest, to the
// conversion action for its kind in our Ads account, with the click ID where the client came by an ad and the number,
// hashed, always. The Worker signs in as our service account: a token it asks Google for with a JWT signed by the
// account's key, kept until five minutes before it lapses. In test mode each request is validateOnly: Google checks it
// and records nothing.

import type { GoogleEvent, GoogleSettings } from "../../config/conversions.ts";
import { toBase64Url } from "../../lib/base64url.ts";
import { vendorFetch, VendorUnreachable, type VendorFetchDependencies } from "../vendor-fetch.ts";
import type { ConversionPlatform, ConversionToSend, SendOutcome } from "./index.ts";

const TIMEOUT_MS = 10_000;
const SCOPE = "https://www.googleapis.com/auth/datamanager";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest";

/** The account's PEM key, as WebCrypto takes it. */
async function signingKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

const encoded = (part: object) => toBase64Url(new TextEncoder().encode(JSON.stringify(part)));

/** The JWT the service account asks for its token with. */
async function assertion(account: GoogleSettings["serviceAccount"], now: Date): Promise<string> {
  const issued = Math.floor(now.getTime() / 1000);
  const unsigned = `${encoded({ alg: "RS256", typ: "JWT" })}.${encoded({
    iss: account.clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: issued,
    exp: issued + 3600,
  })}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await signingKey(account.privateKey),
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Where the event happened, as Meta is told it too: a booking where it was made, a visit or a payment at home. */
function eventSourceOf(conversion: ConversionToSend): "WEB" | "MESSAGE" | "PHONE" | "OTHER" | "IN_STORE" {
  if (conversion.event !== "consult_booked") return "IN_STORE";
  const sources = { website: "WEB", chat: "MESSAGE", phone_call: "PHONE", system: "OTHER" } as const;
  return sources[conversion.bookedVia ?? "system"];
}

/** The event, as events:ingest takes it, with its destination's conversion action. */
function googleRequest(
  settings: GoogleSettings,
  conversion: ConversionToSend & { readonly event: GoogleEvent },
  testMode: boolean,
): Record<string, unknown> {
  // One click ID an event: Google takes gclid, gbraid and wbraid as alternatives, the first a touch carries winning.
  const click = (["gclid", "gbraid", "wbraid"] as const).find((kind) => conversion.clicks[kind] !== null);
  const adIdentifiers = click === undefined ? {} : { [click]: conversion.clicks[click] };
  return {
    destinations: [
      {
        operatingAccount: { accountType: "GOOGLE_ADS", accountId: settings.customerId },
        ...(settings.loginCustomerId === null
          ? {}
          : { loginAccount: { accountType: "GOOGLE_ADS", accountId: settings.loginCustomerId } }),
        productDestinationId: settings.actions[conversion.event],
      },
    ],
    encoding: "HEX",
    events: [
      {
        transactionId: conversion.eventId,
        eventTimestamp: conversion.occurredAt.toISOString(),
        eventSource: eventSourceOf(conversion),
        ...(Object.keys(adIdentifiers).length === 0 ? {} : { adIdentifiers }),
        userData: {
          userIdentifiers: [
            { phoneNumber: conversion.phone.google },
            ...(conversion.place.google === null ? [] : [{ address: conversion.place.google }]),
          ],
        },
        ...(conversion.value === null ? {} : { conversionValue: conversion.value, currency: "INR" }),
      },
    ],
    validateOnly: testMode,
  };
}

/** Google's own words for a refusal, short, holding nothing of the person. */
function refusalOf(body: unknown, status: number): string {
  const error = (body as { error?: { message?: unknown; status?: unknown } } | null)?.error;
  const words = typeof error?.message === "string" ? error.message : "no message";
  return `${String(status)} ${typeof error?.status === "string" ? error.status : ""} ${words}`.slice(0, 300);
}

const retried = (status: number) => status >= 500 || status === 429 || status === 401;

export function createGoogleConversions(
  settings: GoogleSettings,
  testMode: boolean,
  deps: VendorFetchDependencies & { readonly now: () => Date },
): ConversionPlatform {
  let token: { readonly value: string; readonly until: number } | null = null;

  /** The service account's token, asked for again five minutes before it lapses; an outcome where Google gave none. */
  async function bearer(): Promise<string | SendOutcome> {
    const now = deps.now();
    if (token !== null && now.getTime() < token.until) return token.value;
    const answer = await vendorFetch(
      deps,
      { vendor: "google-data-manager", step: "token", timeoutMs: TIMEOUT_MS },
      TOKEN_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: await assertion(settings.serviceAccount, now),
        }),
      },
    );
    if (answer instanceof VendorUnreachable) return { kind: "retry", error: answer.message };
    const body = (await answer.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
      error?: unknown;
    } | null;
    if (!answer.ok || typeof body?.access_token !== "string") {
      const said = `token ${String(answer.status)} ${typeof body?.error === "string" ? body.error : ""}`.trim();
      // Google down, or asked too often, passes; a key deleted or disabled, or an account removed, will not.
      return answer.status >= 500 || answer.status === 429
        ? { kind: "retry", error: said }
        : { kind: "held", error: said };
    }
    const seconds = typeof body.expires_in === "number" ? body.expires_in : 3600;
    token = { value: body.access_token, until: now.getTime() + (seconds - 300) * 1000 };
    return token.value;
  }

  return {
    async send(conversion): Promise<SendOutcome> {
      if (conversion.event === "lead_submit") return { kind: "refused", error: "a lead reaches Google from GA4" };
      const signedIn = await bearer();
      if (typeof signedIn !== "string") return signedIn;
      const answer = await vendorFetch(
        deps,
        { vendor: "google-data-manager", step: "ingest", timeoutMs: TIMEOUT_MS },
        INGEST_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${signedIn}` },
          body: JSON.stringify(googleRequest(settings, { ...conversion, event: conversion.event }, testMode)),
        },
      );
      if (answer instanceof VendorUnreachable) return { kind: "retry", error: answer.message };
      if (answer.ok) return { kind: "sent" };
      if (answer.status === 401) token = null;
      const said = refusalOf(await answer.json().catch(() => null), answer.status);
      // No access to the account, or an account or conversion action Google does not know: every send would fail.
      if (answer.status === 403 || answer.status === 404) return { kind: "held", error: said };
      return retried(answer.status) ? { kind: "retry", error: said } : { kind: "refused", error: said };
    },
  };
}
