// WhatsApp through MSG91's WhatsApp Business Platform, with templates WhatsApp has approved (src/config/approved-templates.ts).
// Only src/providers/messaging/index.ts sends through this module.
//
//   send   POST https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/   header `authkey`
//          { integrated_number, content_type: "template", payload: { messaging_product, type, template } }
//
// A template's variables go as body_1, body_2, …; the try-on's look as header_1; its buttons as button_1, button_2,
// each value added to the address the template was approved with.

import { z } from "zod";
import {
  approvedParams,
  approvedTemplate,
  type ApprovedButton,
  type ApprovedTemplate,
} from "../../config/approved-templates.ts";
import { MSG91_TEMPLATE_LANGUAGE, type Msg91Settings } from "../../config/msg91.ts";
import type { Connection, MessagingProvider, OutboundMessage, SendResult } from "./index.ts";
import { vendorFetch, VendorUnreachable, type VendorFetchDependencies } from "../vendor-fetch.ts";

export const SEND_URL = "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";
const SEND_TIMEOUT_MS = 15_000;

type Component = { readonly type: string; readonly value: string; readonly subtype?: string };

/** The part of a stop link after the site's origin: "stop#token", which the template's button address ends with. */
const pathOf = (link: string): string => link.replace(/^https?:\/\/[^/]+\//, "");

/** What a button's address ends with for this message; null when the message lacks it. */
function buttonValue(button: ApprovedButton, message: OutboundMessage): string | null {
  if (button.kind === "copy_code") return message.params[0] ?? null;
  const link = button.kind === "stop" ? message.stopLink : message.params[button.param - 1];
  return link === undefined ? null : pathOf(link);
}

/** The components a send fills in: the body's variables, then the image and the buttons the template has. */
function componentsOf(
  template: ApprovedTemplate,
  values: readonly string[],
  message: OutboundMessage,
): Record<string, Component> | null {
  const components: Record<string, Component> = {};
  values.forEach((value, index) => {
    components[`body_${String(index + 1)}`] = { type: "text", value };
  });
  if (template.imageHeader) {
    if (message.media === undefined) return null;
    components.header_1 = { type: "image", value: message.media.url };
  }
  for (const [index, button] of template.buttons.entries()) {
    const value = buttonValue(button, message);
    if (value === null) return null;
    components[`button_${String(index + 1)}`] = { subtype: "url", type: "text", value };
  }
  return components;
}

export function createMsg91Messaging(settings: Msg91Settings, deps: VendorFetchDependencies): MessagingProvider {
  return {
    async send(message): Promise<SendResult> {
      const template = approvedTemplate(message.template);
      const values = template === null ? null : approvedParams(template, message.params);
      const components = template === null || values === null ? null : componentsOf(template, values, message);
      if (template === null || components === null) {
        return { ok: false, transient: false, detail: `template ${message.template} cannot be sent as approved` };
      }
      const body = {
        integrated_number: settings.integratedNumber,
        content_type: "template",
        payload: {
          messaging_product: "whatsapp",
          type: "template",
          template: {
            name: template.name,
            language: { code: MSG91_TEMPLATE_LANGUAGE, policy: "deterministic" },
            namespace: null,
            to_and_components: [{ to: [message.to.replace(/\D/g, "")], components }],
          },
        },
      };
      const response = await vendorFetch(
        deps,
        { vendor: "msg91", step: "send_template", timeoutMs: SEND_TIMEOUT_MS, codeOf: errorCodeIn },
        SEND_URL,
        {
          method: "POST",
          headers: { authkey: settings.authKey, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      // No answer in time: MSG91 may have taken it, and sending again would send it twice.
      if (response instanceof VendorUnreachable && response.timedOut) {
        return { ok: false, transient: false, detail: "no reply in time: delivery unconfirmed" };
      }
      if (response instanceof VendorUnreachable) {
        return { ok: false, transient: true, detail: `unreachable: ${response.reason}` };
      }
      const reply = jsonOf(await response.text());
      if (response.ok && Accepted.safeParse(reply).success) return { ok: true, providerMessageId: requestIdOf(reply) };
      return refusal(response.status, reply);
    },

    // Nothing to hold open: a template goes from MSG91's servers, not from a phone kept signed in.
    connection: (): Promise<Connection> => Promise.resolve({ open: true }),
  };
}

/**
 * What a refused send means. A refused key is MSG91's account, not the message, so the message waits; a 429 or a
 * 5xx is worth trying again soon; anything else, such as a template not approved, will not go as it stands.
 */
function refusal(status: number, reply: unknown): SendResult {
  const detail = `HTTP ${String(status)} ${errorCodeIn(reply)}`.trim();
  if (status === 401 || status === 403) return { ok: false, transient: false, bridgeDown: true, detail };
  return { ok: false, transient: status === 429 || status >= 500, detail };
}

/** MSG91 answers HTTP 200 with `hasError` or `status: "fail"` when it refuses a send. */
const Accepted = z.looseObject({ hasError: z.literal(false).optional(), status: z.literal("success").optional() });
const RequestId = z.looseObject({ request_id: z.string() });
const Refused = z.looseObject({ errors: z.unknown().optional(), message: z.string().optional() });

function jsonOf(reply: string): unknown {
  try {
    return JSON.parse(reply);
  } catch {
    return null;
  }
}

const requestIdOf = (reply: unknown): string | null => RequestId.safeParse(reply).data?.request_id ?? null;

/** A short code for the log; numbers are masked, since a refusal may echo the recipient. */
function errorCodeIn(reply: unknown): string {
  const refused = Refused.safeParse(reply).data;
  const text = refused?.message ?? (typeof refused?.errors === "string" ? refused.errors : "");
  return text.slice(0, 60).replace(/\d/g, "#");
}
