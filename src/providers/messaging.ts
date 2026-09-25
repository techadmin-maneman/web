// WhatsApp messaging, behind an interface. The messaging consumer is the only
// caller; nothing else knows which BSP is behind it.

import type { Logger } from "../log.ts";
import { createEvolutionMessaging, type EvolutionSettings } from "./evolution.ts";

export type SendResult =
  | { readonly ok: true; readonly providerMessageId: string | null }
  | {
      readonly ok: false;
      /** A timeout, a 5xx or a 429: worth trying again. */
      readonly transient: boolean;
      /** The provider's status and code. Never the number or the message. */
      readonly detail: string;
    };

export interface OutboundMessage {
  /** The recipient, as E.164. */
  readonly to: string;
  /** A template in src/config/message-templates.ts. */
  readonly template: string;
  /** The template's {{1}}, {{2}}, …, in order. */
  readonly params: readonly string[];
  /** A publicly reachable image to send with the text. */
  readonly mediaUrl?: string;
}

/** Whether the provider can reach WhatsApp now; if not, what it said. */
export type Connection = { readonly open: true } | { readonly open: false; readonly detail: string };

export interface MessagingProvider {
  send(message: OutboundMessage): Promise<SendResult>;
  /** Read only: nothing is sent. Every login code goes this way, so the cron asks (src/scheduled/whatsapp-bridge.ts). */
  connection(): Promise<Connection>;
}

export function createMessagingProvider(
  evolution: EvolutionSettings | null,
  deps: { fetch: typeof fetch; log: Logger },
): MessagingProvider {
  return evolution === null ? createStubMessaging(deps.log) : createEvolutionMessaging(evolution, deps);
}

/** Local and test stand-in: sends nothing, logs no number, reports success. */
export function createStubMessaging(log: Logger): MessagingProvider {
  return {
    send: ({ template, params, mediaUrl }) => {
      log.info("messaging_stub_send", { template, params: params.length, media: mediaUrl !== undefined });
      return Promise.resolve({ ok: true, providerMessageId: `stub-${crypto.randomUUID()}` });
    },
    connection: () => Promise.resolve({ open: true }),
  };
}
