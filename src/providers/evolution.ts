// WhatsApp through an Evolution API bridge (docs/decisions/0016-whatsapp-through-evolution.md).
// Only src/providers/messaging.ts imports this module.
//
//   send   POST {base}/message/sendMedia/{instance}   { number, mediatype, mimetype, caption, media, fileName }
//          POST {base}/message/sendText/{instance}    { number, text }
//   state  GET  {base}/instance/connectionState/{instance}   { instance: { state: "open" | "connecting" | "close" } }
//   auth   header `apikey`
//
// Evolution drives a WhatsApp account directly, so there are no Meta-approved
// templates: a "template" here is one of the texts in src/config/message-templates.ts.
// The bridge downloads the image itself, so mediaUrl must be publicly reachable.

import { renderMessage } from "../config/message-templates.ts";
import type { Connection, MessagingProvider, SendResult } from "./messaging.ts";

export interface EvolutionSettings {
  /** https://…, no trailing slash. */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly instance: string;
  /** The secret in the delivery-receipt webhook's path. Unset, the webhook answers 404. */
  readonly webhookToken: string | null;
}

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
  deps: { fetch: typeof fetch },
): MessagingProvider {
  return {
    async send({ to, template, params, mediaUrl }): Promise<SendResult> {
      const text = renderMessage(template, params);
      if (text === null) return { ok: false, transient: false, detail: `unknown template ${template}` };

      const number = to.replace(/\D/g, ""); // "+919810000000" -> "919810000000"
      const [path, body] =
        mediaUrl === undefined
          ? (["sendText", { number, text }] as const)
          : ([
              "sendMedia",
              {
                number,
                mediatype: "image",
                mimetype: "image/png",
                caption: text,
                media: mediaUrl,
                fileName: "mane-man.png",
              },
            ] as const);
      const timeoutMs = SEND_TIMEOUT_MS[path];

      let response: Response;
      try {
        response = await deps.fetch(`${settings.baseUrl}/message/${path}/${encodeURIComponent(settings.instance)}`, {
          method: "POST",
          headers: { apikey: settings.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : "error";
        // A timeout means the bridge took the request and did not answer: the message may be on the
        // phone already, and sending again would duplicate it. Only a failure to connect is retried.
        if (name === "TimeoutError") {
          return {
            ok: false,
            transient: false,
            detail: `no reply within ${String(timeoutMs / 1000)} s: delivery unconfirmed`,
          };
        }
        return { ok: false, transient: true, detail: `unreachable: ${name}` };
      }

      const reply = await response.text();
      if (response.ok) {
        return { ok: true, providerMessageId: messageIdOf(reply) };
      }
      // A 4xx other than 429 is a bad request, a bad key or a missing instance: retrying cannot help.
      // "Connection Closed" is the bridge losing its WhatsApp socket, which it recovers from.
      const transient = response.status === 429 || response.status >= 500 || reply.includes("Connection Closed");
      return { ok: false, transient, detail: `HTTP ${String(response.status)} ${errorCodeOf(reply)}` };
    },

    // The runbook's first check when WhatsApp is down, made by the cron instead.
    async connection(): Promise<Connection> {
      let response: Response;
      try {
        response = await deps.fetch(
          `${settings.baseUrl}/instance/connectionState/${encodeURIComponent(settings.instance)}`,
          { method: "GET", headers: { apikey: settings.apiKey }, signal: AbortSignal.timeout(STATE_TIMEOUT_MS) },
        );
      } catch (error) {
        return { open: false, detail: `unreachable: ${error instanceof Error ? error.name : "error"}` };
      }
      if (!response.ok) return { open: false, detail: `HTTP ${String(response.status)}` };
      const state = stateOf(await response.text());
      return state === "open" ? { open: true } : { open: false, detail: `state ${state}` };
    },
  };
}

/** Evolution 2 answers `{ instance: { state } }`; earlier versions answered `{ state }`. */
function stateOf(reply: string): string {
  try {
    const answer = JSON.parse(reply) as { instance?: { state?: unknown }; state?: unknown };
    const state = answer.instance?.state ?? answer.state;
    return typeof state === "string" ? state : "unknown";
  } catch {
    return "unknown";
  }
}

function messageIdOf(reply: string): string | null {
  try {
    const id = (JSON.parse(reply) as { key?: { id?: unknown } }).key?.id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/** The error code only; the message may echo the number. */
function errorCodeOf(reply: string): string {
  try {
    const code = (JSON.parse(reply) as { error?: { code?: unknown } | string }).error;
    if (typeof code === "object" && typeof code.code === "string") return code.code;
    return typeof code === "string" ? code.slice(0, 60).replace(/\d/g, "#") : "";
  } catch {
    return "";
  }
}
