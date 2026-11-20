// Meta's Conversions API, the main one (docs/decisions/0288-attribution-and-conversions.md): one event a request to
// the dataset's /events, the token in the body so no URL a proxy logs holds it. A lead from the site is a website
// event under the ID the browser's Pixel used, so Meta counts the two once; a consultation done and a payment happen
// at the client's home, so they are a physical store's. In test mode each event carries the Test Events code, and
// shows only in Events Manager's Test Events.

import type { MetaSettings } from "../../config/conversions.ts";
import { vendorFetch, VendorUnreachable, type VendorFetchDependencies } from "../vendor-fetch.ts";
import type { ConversionPlatform, ConversionToSend, SendOutcome } from "./index.ts";

/** The Graph API version the calls name: v26.0, current since July 2026. */
const GRAPH_VERSION = "v26.0";

const TIMEOUT_MS = 10_000;

/** Each of ours as Meta names it: its standard events where one fits, our own name where none does. */
const EVENT_NAME: Readonly<Record<ConversionToSend["event"], string>> = {
  lead_submit: "Lead",
  consult_booked: "Schedule",
  consult_done: "ConsultationDone",
  first_fit_paid: "Purchase",
  service_paid: "ServicePaid",
};

/** Where it happened, as Meta asks: a lead on the site with its browser, at the client's home, or by our own system. */
function actionSourceOf(conversion: ConversionToSend): "website" | "physical_store" | "system_generated" {
  if (conversion.event === "lead_submit") {
    return conversion.browser.userAgent !== null && conversion.sourceUrl !== null ? "website" : "system_generated";
  }
  return conversion.event === "consult_booked" ? "system_generated" : "physical_store";
}

/** The event, as Meta's /events takes it. */
export function metaEvent(conversion: ConversionToSend): Record<string, unknown> {
  const source = actionSourceOf(conversion);
  const { browser } = conversion;
  const userData: Record<string, unknown> = {
    ph: [conversion.phone.meta],
    external_id: [conversion.externalId],
    ...(conversion.firstName === null ? {} : { fn: [conversion.firstName] }),
    ...(browser.fbc === null ? {} : { fbc: browser.fbc }),
    ...(browser.fbp === null ? {} : { fbp: browser.fbp }),
    ...(browser.ip === null ? {} : { client_ip_address: browser.ip }),
    ...(browser.userAgent === null ? {} : { client_user_agent: browser.userAgent }),
  };
  return {
    event_name: EVENT_NAME[conversion.event],
    event_time: Math.floor(conversion.occurredAt.getTime() / 1000),
    event_id: conversion.eventId,
    action_source: source,
    ...(source === "website" && conversion.sourceUrl !== null ? { event_source_url: conversion.sourceUrl } : {}),
    user_data: userData,
    ...(conversion.value === null ? {} : { custom_data: { currency: "INR", value: conversion.value } }),
  };
}

/** Meta's own words for a refusal, short, holding nothing of the person. */
function refusalOf(body: unknown, status: number): string {
  const error = (body as { error?: { message?: unknown; code?: unknown } } | null)?.error;
  const words = typeof error?.message === "string" ? error.message : "no message";
  return `${String(status)} ${typeof error?.code === "number" ? String(error.code) : ""} ${words}`.slice(0, 300);
}

/**
 * Whether Meta refused our account rather than the event: no access (401, 403), the token lapsed or revoked (190), a
 * permission missing (10, 200), or a dataset it cannot find (100, sub-code 33).
 */
function accountRefused(body: unknown, status: number): boolean {
  const error = (body as { error?: { code?: unknown; error_subcode?: unknown } } | null)?.error;
  return (
    status === 401 ||
    status === 403 ||
    error?.code === 190 ||
    error?.code === 10 ||
    error?.code === 200 ||
    (error?.code === 100 && error.error_subcode === 33)
  );
}

export function createMetaConversions(
  settings: MetaSettings,
  testMode: boolean,
  deps: VendorFetchDependencies,
): ConversionPlatform {
  return {
    async send(conversion): Promise<SendOutcome> {
      const body = {
        data: [metaEvent(conversion)],
        access_token: settings.token,
        ...(testMode && settings.testEventCode !== null ? { test_event_code: settings.testEventCode } : {}),
      };
      const answer = await vendorFetch(
        deps,
        { vendor: "meta", step: "events", timeoutMs: TIMEOUT_MS },
        `https://graph.facebook.com/${GRAPH_VERSION}/${settings.datasetId}/events`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (answer instanceof VendorUnreachable) return { kind: "retry", error: answer.message };
      if (answer.ok) return { kind: "sent" };
      const refusal: unknown = await answer.json().catch(() => null);
      const said = refusalOf(refusal, answer.status);
      if (accountRefused(refusal, answer.status)) return { kind: "held", error: said };
      // Meta's own trouble, or too many at once, passes; anything else it said of the event will not.
      return answer.status >= 500 || answer.status === 429
        ? { kind: "retry", error: said }
        : { kind: "refused", error: said };
    },
  };
}
