// Messaging's local and test stand-in (./index.ts chooses it).

import { renderWithStopLink } from "../../config/message-templates.ts";
import type { Logger } from "../../log.ts";
import type { MessagingProvider } from "./index.ts";

/**
 * Local and test stand-in: sends nothing and logs no number. It renders the text as the bridge would, so a message
 * missing one of its template's params fails here as it would there; otherwise it reports success.
 */
export function createStubMessaging(log: Logger): MessagingProvider {
  return {
    send: ({ template, params, media, stopLink }) => {
      if (renderWithStopLink(template, params, stopLink) === null) {
        return Promise.resolve({ ok: false, transient: false, detail: `template ${template} is missing a param` });
      }
      log.info("messaging_stub_send", {
        template,
        params: params.length,
        media: media !== undefined,
        stop_link: stopLink !== undefined,
      });
      return Promise.resolve({ ok: true, providerMessageId: `stub-${crypto.randomUUID()}` });
    },
    connection: () => Promise.resolve({ open: true }),
  };
}
