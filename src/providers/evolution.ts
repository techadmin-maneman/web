// WhatsApp through an Evolution API bridge (docs/decisions/0016-whatsapp-through-evolution.md).
// Only src/providers/messaging.ts imports this module.
//
//   send  POST {base}/message/sendMedia/{instance}   { number, mediatype, mimetype, caption, media, fileName }
//         POST {base}/message/sendText/{instance}    { number, text }
//   auth  header `apikey`
//
// Evolution drives a WhatsApp account directly, so there are no Meta-approved
// templates: a "template" here is one of the texts in src/config/message-templates.ts.
// The bridge downloads the image itself, so mediaUrl must be publicly reachable.

import { renderMessage } from "../config/message-templates.ts";
import type { MessagingProvider, SendResult } from "./messaging.ts";

export interface EvolutionSettings {
  /** https://…, no trailing slash. */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly instance: string;
}

const TIMEOUT_MS = 20_000;

export function createEvolutionMessaging(
  settings: EvolutionSettings,
  deps: { fetch: typeof fetch },
): MessagingProvider {
  return {
    async sendTemplate(to, templateName, params, mediaUrl): Promise<SendResult> {
      const text = renderMessage(templateName, params);
      if (text === null) return { ok: false, transient: false, detail: `unknown template ${templateName}` };

      const number = to.replace(/\D/g, ""); // "+919810000000" -> "919810000000"
      const [path, body] =
        mediaUrl === undefined
          ? ["sendText", { number, text }]
          : [
              "sendMedia",
              {
                number,
                mediatype: "image",
                mimetype: "image/png",
                caption: text,
                media: mediaUrl,
                fileName: "mane-man.png",
              },
            ];

      let response: Response;
      try {
        response = await deps.fetch(`${settings.baseUrl}/message/${path}/${encodeURIComponent(settings.instance)}`, {
          method: "POST",
          headers: { apikey: settings.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        return { ok: false, transient: true, detail: `unreachable: ${error instanceof Error ? error.name : "error"}` };
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
  };
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
