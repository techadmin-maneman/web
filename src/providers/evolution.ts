// WhatsApp through an Evolution API bridge (docs/decisions/0016-whatsapp-through-evolution.md).
// Only src/providers/messaging.ts sends through this module.
//
//   send   POST {base}/message/sendMedia/{instance}   { number, mediatype, mimetype, caption, media, fileName }
//          POST {base}/message/sendText/{instance}    { number, text }
//   state  GET  {base}/instance/connectionState/{instance}   { instance: { state: "open" | "connecting" | "close" } }
//   auth   header `apikey`
//
// Evolution drives a WhatsApp account directly, so there are no Meta-approved
// templates: a "template" here is one of the texts in src/config/message-templates.ts.
// The bridge downloads the image itself, so mediaUrl must be publicly reachable.

import { z } from "zod";
import { renderWithStopLink } from "../config/message-templates.ts";
import { fileExtension } from "../lib/image-bytes.ts";
import type { Connection, MessagingProvider, SendResult } from "./messaging.ts";
import { vendorFetch, VendorUnreachable, type VendorFetchDependencies } from "./vendor-fetch.ts";
import type { EvolutionSettings } from "../config/evolution.ts";

/**
 * The bridge answers a media send only after it has fetched the image and
 * uploaded it to WhatsApp. On staging a send that outlived a 20 s limit had
 * already fetched the image, so that limit is generous. A text has nothing to
 * fetch, and a login code is sent after the response, where the runtime allows
 * 30 s: its 20 s ends with a line in the log rather than being cut off.
 */
export const SEND_TIMEOUT_MS = { sendText: 20_000, sendMedia: 60_000 } as const;
const STATE_TIMEOUT_MS = 10_000;

export function createEvolutionMessaging(
  settings: EvolutionSettings,
  deps: VendorFetchDependencies,
): MessagingProvider {
  return {
    async send({ to, template, params, media, stopLink }): Promise<SendResult> {
      const text = renderWithStopLink(template, params, stopLink);
      if (text === null) return { ok: false, transient: false, detail: `template ${template} is missing a param` };

      const number = to.replace(/\D/g, ""); // "+919810000000" -> "919810000000"
      const [path, body] =
        media === undefined
          ? (["sendText", { number, text }] as const)
          : ([
              "sendMedia",
              {
                number,
                mediatype: "image",
                mimetype: media.type,
                caption: text,
                media: media.url,
                fileName: `mane-man.${fileExtension(media.type)}`,
              },
            ] as const);
      const timeoutMs = SEND_TIMEOUT_MS[path];

      const response = await vendorFetch(
        deps,
        { vendor: "evolution", step: path, timeoutMs, codeOf: errorCodeIn },
        `${settings.baseUrl}/message/${path}/${encodeURIComponent(settings.instance)}`,
        {
          method: "POST",
          headers: { apikey: settings.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      // A timeout means the bridge took the request and did not answer: the message may be on the
      // phone already, and sending again would duplicate it. Only a failure to connect is retried.
      if (response instanceof VendorUnreachable && response.timedOut) {
        return {
          ok: false,
          transient: false,
          detail: `no reply within ${String(timeoutMs / 1000)} s: delivery unconfirmed`,
        };
      }
      if (response instanceof VendorUnreachable) {
        return { ok: false, transient: true, detail: `unreachable: ${response.reason}` };
      }

      const reply = await response.text();
      if (response.ok) {
        return { ok: true, providerMessageId: messageIdOf(reply) };
      }
      return refusal(response.status, reply, settings.instance);
    },

    // The runbook's first check when WhatsApp is down, made by the cron instead.
    async connection(): Promise<Connection> {
      const response = await vendorFetch(
        deps,
        { vendor: "evolution", step: "connection_state", timeoutMs: STATE_TIMEOUT_MS, codeOf: errorCodeIn },
        `${settings.baseUrl}/instance/connectionState/${encodeURIComponent(settings.instance)}`,
        { method: "GET", headers: { apikey: settings.apiKey } },
      );
      if (response instanceof VendorUnreachable) {
        return { open: false, fault: "unreachable", detail: `unreachable: ${response.reason}` };
      }
      const status = String(response.status);
      if (response.status === 404) {
        return { open: false, fault: "no_instance", detail: noInstance(settings.instance) };
      }
      if (response.status === 401 || response.status === 403) {
        return { open: false, fault: "key_refused", detail: `HTTP ${status}` };
      }
      if (!response.ok) return { open: false, fault: "unreachable", detail: `HTTP ${status}` };
      const state = stateOf(await response.text());
      if (state === "open") return { open: true };
      return { open: false, fault: "logged_out", detail: `state ${state}` };
    },
  };
}

/**
 * What a refused send means. A missing instance, a refused key or a closed WhatsApp session is the bridge's fault,
 * not the message's, so the message waits for the bridge. A 429 or a 5xx is worth trying again soon. Any other 4xx,
 * such as a number not on WhatsApp, will never go.
 */
function refusal(status: number, reply: string, instance: string): SendResult {
  if (status === 404) return { ok: false, transient: false, bridgeDown: true, detail: noInstance(instance) };
  const detail = `HTTP ${String(status)} ${errorCodeIn(jsonOf(reply))}`;
  if (status === 401 || status === 403 || reply.includes("Connection Closed")) {
    return { ok: false, transient: false, bridgeDown: true, detail };
  }
  const transient = status === 429 || status >= 500;
  return { ok: false, transient, detail };
}

/** A 404 from the bridge: the instance in the path is not one it has. */
const noInstance = (instance: string): string =>
  `the bridge has no instance named "${instance}": wrong URL or port, or the instance was deleted`;

/** Evolution 2 answers `{ instance: { state } }`; earlier versions answered `{ state }`. */
const State = z.union([z.object({ instance: z.object({ state: z.string() }) }), z.object({ state: z.string() })]);
const Sent = z.object({ key: z.object({ id: z.string() }) });
const Refused = z.object({ error: z.union([z.object({ code: z.string() }), z.string()]) });

/** The bridge's reply as JSON; null when it is not JSON. */
function jsonOf(reply: string): unknown {
  try {
    return JSON.parse(reply);
  } catch {
    return null;
  }
}

/** The bridge's reply read as `schema`; null when it is not JSON, or not that shape. */
function read<T>(schema: z.ZodType<T>, reply: string): T | null {
  return schema.safeParse(jsonOf(reply)).data ?? null;
}

function stateOf(reply: string): string {
  const answer = read(State, reply);
  if (answer === null) return "unknown";
  return "instance" in answer ? answer.instance.state : answer.state;
}

const messageIdOf = (reply: string): string | null => read(Sent, reply)?.key.id ?? null;

/** The error code only; the message may echo the number. */
function errorCodeIn(json: unknown): string {
  const error = Refused.safeParse(json).data?.error;
  if (error === undefined) return "";
  if (typeof error === "string") return error.slice(0, 60).replace(/\d/g, "#");
  return error.code;
}
