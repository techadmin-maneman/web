// Sends a one-time login code (docs/decisions/0030-one-time-codes.md). WhatsApp
// goes through the messaging provider, like every other message. SMS needs a
// DLT-registered template: MSG91 sends it once SMS_PROVIDER is "msg91"; until
// then it is "none" and the app offers WhatsApp only. The code is never logged.

import type { Msg91SmsSettings } from "../config/msg91.ts";
import type { MessagingProvider, SendResult } from "./messaging/index.ts";
import { sendSmsCode } from "./msg91-sms.ts";
import type { VendorFetchDependencies } from "./vendor-fetch.ts";

export type CodeChannel = "whatsapp" | "sms";

const LOGIN_CODE_TEMPLATE = "login_code_v1";

export interface CodeSender {
  /** Whether a code can go by SMS at all. */
  readonly smsAvailable: boolean;
  send(channel: CodeChannel, to: string, code: string): Promise<SendResult>;
}

export function createCodeSender(
  smsProvider: string,
  sms: Msg91SmsSettings | null,
  deps: VendorFetchDependencies & { messaging: MessagingProvider },
): CodeSender {
  return {
    smsAvailable: smsProvider !== "none",
    send(channel, to, code) {
      if (channel === "whatsapp") return deps.messaging.send({ to, template: LOGIN_CODE_TEMPLATE, params: [code] });
      if (sms !== null) return sendSmsCode(sms, deps, { to, code });
      if (smsProvider === "stub") {
        deps.log.info("sms_stub_send", { template: LOGIN_CODE_TEMPLATE });
        return Promise.resolve({ ok: true, providerMessageId: `stub-${crypto.randomUUID()}` });
      }
      return Promise.resolve({ ok: false, transient: false, detail: "no SMS provider" });
    },
  };
}
