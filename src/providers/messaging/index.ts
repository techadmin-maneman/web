// WhatsApp messaging, behind an interface: Evolution's bridge or MSG91. Its callers are the messaging
// consumer, the login codes and the word that an account is deleted
// (src/queues/messaging.ts); none of them knows which BSP is behind it.

import { type TemplateName } from "../../config/message-templates.ts";
import type { ImageType } from "../../lib/image-bytes.ts";
import type { Logger } from "../../log.ts";
import { createEvolutionMessaging } from "./evolution.ts";
import { createMsg91Messaging } from "./msg91.ts";
import { createStubMessaging } from "./stub.ts";
import type { MessagingSettings } from "../../config/settings.ts";

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
  readonly template: TemplateName;
  /** The template's {{1}}, {{2}}, …, in order. */
  readonly params: readonly string[];
  /** An image to send with the text: a publicly reachable link to it, and its type. */
  readonly media?: { readonly url: string; readonly type: ImageType };
  /** The link that stops messages of this kind, which the text ends with. */
  readonly stopLink?: string;
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

/** Whoever MESSAGING_PROVIDER names: Evolution's bridge, MSG91, or the stub. */
export function createMessagingProvider(
  settings: Pick<MessagingSettings, "evolution" | "msg91">,
  deps: { fetch: typeof fetch; log: Logger },
): MessagingProvider {
  if (settings.msg91 !== null) return createMsg91Messaging(settings.msg91, deps);
  if (settings.evolution !== null) return createEvolutionMessaging(settings.evolution, deps);
  return createStubMessaging(deps.log);
}
