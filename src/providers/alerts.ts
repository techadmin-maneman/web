// Messages to a chat webhook (Slack, Google Chat or Discord): alerts, which need
// someone to act, and new-lead notices. Posting must never break the work that
// asked for it, so failures are logged, not thrown; a post answers whether the
// chat took it, so an alert it missed is told again. Messages are scrubbed of
// phone numbers and e-mail addresses as a last defence; callers pass IDs,
// cities and dates, never personal data.

import { scrubString, type Logger, type LogLevel } from "../log.ts";
import { vendorFetch, VendorUnreachable } from "./vendor-fetch.ts";

const TIMEOUT_MS = 5_000;

/** Posts the message; it comes to false when the chat did not take it. */
export type Alert = (message: string) => Promise<unknown>;
export type LeadNotice = (message: string) => Promise<unknown>;

interface ChatOptions {
  readonly webhookUrl: string | null;
  readonly environment: string;
  readonly fetch: typeof fetch;
  readonly log: Logger;
}

export function createAlert(options: ChatOptions): Alert {
  return createChatPost(options, "warn", "alert");
}

export function createLeadNotice(options: ChatOptions): LeadNotice {
  return createChatPost(options, "info", "lead_notice");
}

function createChatPost(options: ChatOptions, level: LogLevel, event: string): (message: string) => Promise<boolean> {
  const { webhookUrl, environment, fetch, log } = options;

  return async (message) => {
    const text = scrubString(`[mm-api ${environment}] ${message}`);
    log[level](event, { text });
    // With no chat to post to, the log line is all there is to tell.
    if (webhookUrl === null) return true;

    // Discord reads "content"; Slack and Google Chat read "text" (and Google Chat rejects unknown keys).
    const body = new URL(webhookUrl).hostname.endsWith("discord.com") ? { content: text } : { text };
    const response = await vendorFetch(
      { fetch, log },
      { vendor: "chat-webhook", step: event, timeoutMs: TIMEOUT_MS },
      webhookUrl,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    if (response instanceof VendorUnreachable) {
      log.error(`${event}_not_delivered`, { error: response });
      return false;
    }
    if (!response.ok) log.error(`${event}_not_delivered`, { status: response.status });
    return response.ok;
  };
}
