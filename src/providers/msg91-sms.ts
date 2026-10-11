// A login code by SMS through MSG91, from the template DLT approved (docs/decisions/0030-one-time-codes.md). Only
// src/providers/codes.ts sends through this module.
//
//   send   POST https://control.msg91.com/api/v5/flow   header `authkey`
//          { template_id, short_url: "0", recipients: [{ mobiles, otp }] }
//
// The text is DLT's to approve, so it lives in MSG91 under the template, not here; its one variable is ##otp##
// (docs/provisioning.md, "Login codes by SMS").

import { z } from "zod";
import type { Msg91SmsSettings } from "../config/msg91.ts";
import type { SendResult } from "./messaging/index.ts";
import { vendorFetch, VendorUnreachable, type VendorFetchDependencies } from "./vendor-fetch.ts";

export const SMS_URL = "https://control.msg91.com/api/v5/flow";
const SEND_TIMEOUT_MS = 10_000;

/** MSG91 answers `{ type: "success", message: <its request ID> }`, or `type: "error"` with what it refused. */
const Reply = z.looseObject({ type: z.string(), message: z.string().optional() });

export async function sendSmsCode(
  settings: Msg91SmsSettings,
  deps: VendorFetchDependencies,
  sms: { readonly to: string; readonly code: string },
): Promise<SendResult> {
  const body = {
    template_id: settings.templateId,
    short_url: "0",
    recipients: [{ mobiles: sms.to.replace(/\D/g, ""), otp: sms.code }],
  };
  const response = await vendorFetch(
    deps,
    { vendor: "msg91", step: "send_sms", timeoutMs: SEND_TIMEOUT_MS, codeOf: errorIn },
    SMS_URL,
    {
      method: "POST",
      headers: { authkey: settings.authKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (response instanceof VendorUnreachable && response.timedOut) {
    return { ok: false, transient: false, detail: "no reply in time: delivery unconfirmed" };
  }
  if (response instanceof VendorUnreachable) {
    return { ok: false, transient: true, detail: `unreachable: ${response.reason}` };
  }
  const reply = replyOf(await response.text());
  if (response.ok && reply?.type === "success") return { ok: true, providerMessageId: reply.message ?? null };
  const detail = `HTTP ${String(response.status)} ${errorIn(reply)}`.trim();
  return { ok: false, transient: response.status === 429 || response.status >= 500, detail };
}

function replyOf(text: string): z.infer<typeof Reply> | null {
  try {
    return Reply.safeParse(JSON.parse(text)).data ?? null;
  } catch {
    return null;
  }
}

/** A short code for the log; numbers are masked, since a refusal may echo the recipient. */
function errorIn(reply: unknown): string {
  const refused = Reply.safeParse(reply).data;
  return refused?.type === "success" ? "" : (refused?.message ?? "").slice(0, 60).replace(/\d/g, "#");
}
