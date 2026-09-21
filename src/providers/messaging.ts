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

export interface MessagingProvider {
  /** Sends an approved template to an E.164 number, with an image header when mediaUrl is given. */
  sendTemplate(to: string, templateName: string, params: readonly string[], mediaUrl?: string): Promise<SendResult>;
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
    sendTemplate: (_to, templateName, params, mediaUrl) => {
      log.info("messaging_stub_send", { template: templateName, params: params.length, media: mediaUrl !== undefined });
      return Promise.resolve({ ok: true, providerMessageId: `stub-${crypto.randomUUID()}` });
    },
  };
}
