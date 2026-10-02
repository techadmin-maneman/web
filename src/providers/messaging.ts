// WhatsApp messaging, behind an interface. The messaging consumer is the only
// caller; nothing else knows which BSP is behind it.

import type { Logger } from "../log.ts";
import { createEvolutionMessaging, type EvolutionSettings } from "./evolution.ts";

export type SendResult =
  | { readonly ok: true; readonly providerMessageId: string | null }
  | {
      readonly ok: false;
      /** An unreachable bridge, a 5xx or a 429: worth trying again soon. */
      readonly transient: boolean;
      /**
       * The bridge itself cannot send anything: no such instance, a refused key, or its WhatsApp session closed.
       * The message is not at fault, so it waits for the bridge rather than failing.
       */
      readonly bridgeDown?: boolean;
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

/** Why the bridge cannot reach WhatsApp. Each has its own fix (src/scheduled/whatsapp-bridge.ts). */
export type BridgeFault = "no_instance" | "key_refused" | "logged_out" | "unreachable";

/** Whether the provider can reach WhatsApp now; if not, why, and what it said. */
export type Connection =
  { readonly open: true } | { readonly open: false; readonly fault: BridgeFault; readonly detail: string };

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
