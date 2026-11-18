// Messages to a chat webhook (Slack, Google Chat or Discord): alerts, which need
// someone to act, and new-lead notices. Posting must never break the work that
// asked for it, so failures are logged, not thrown; a post answers whether the
// chat took it, so an alert it missed is told again. Messages are scrubbed of
// phone numbers and e-mail addresses as a last defence; callers pass IDs,
// cities and dates, never personal data.

import { scrubString, type Logger, type LogLevel } from "../log.ts";
import { vendorFetch, VendorUnreachable } from "./vendor-fetch.ts";

const TIMEOUT_MS = 5_000;

/** How long a chat that refused a post as too many (429) with no Retry-After is left alone. */
const BUSY_MS = 60_000;

/**
 * When each chat, by its webhook, takes posts again after refusing one as too many: what it asked in Retry-After, or a
 * minute. Kept for the isolate, so a burst of alerts stops at the first refusal rather than each waiting for its own;
 * what was not posted is told by the retell pass (src/domain/platform/alerts.ts).
 */
const busyUntil = new Map<string, number>();

/** Retry-After as milliseconds from now: seconds, or an HTTP date. */
function retryAfterMs(header: string | null): number {
  if (header === null) return BUSY_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? BUSY_MS : Math.max(0, at - Date.now());
}

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

/**
 * The post each kind of webhook reads. An ntfy topic (a phone push, for the urgent space) takes the text as its body
 * at urgent priority, which sounds through Do Not Disturb; Discord reads "content"; Slack and Google Chat read "text"
 * (and Google Chat rejects unknown keys).
 */
function postOf(webhookUrl: string, text: string, environment: string): RequestInit {
  const host = new URL(webhookUrl).hostname;
  if (host === "ntfy.sh" || host.startsWith("ntfy.")) {
    return {
      method: "POST",
      headers: { Title: `Mane Man ${environment}`, Priority: "urgent", Tags: "rotating_light" },
      body: text,
    };
  }
  const body = host.endsWith("discord.com") ? { content: text } : { text };
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function createChatPost(options: ChatOptions, level: LogLevel, event: string): (message: string) => Promise<boolean> {
  const { webhookUrl, environment, fetch, log } = options;

  return async (message) => {
    const text = scrubString(`[mm-api ${environment}] ${message}`);
    log[level](event, { text });
    // With no chat to post to, the log line is all there is to tell.
    if (webhookUrl === null) return true;
    if ((busyUntil.get(webhookUrl) ?? 0) > Date.now()) {
      log.warn(`${event}_deferred`);
      return false;
    }

    const response = await vendorFetch(
      { fetch, log },
      { vendor: "chat-webhook", step: event, timeoutMs: TIMEOUT_MS },
      webhookUrl,
      postOf(webhookUrl, text, environment),
    );
    if (response instanceof VendorUnreachable) {
      log.error(`${event}_not_delivered`, { error: response });
      return false;
    }
    if (response.status === 429)
      busyUntil.set(webhookUrl, Date.now() + retryAfterMs(response.headers.get("Retry-After")));
    if (!response.ok) log.error(`${event}_not_delivered`, { status: response.status });
    return response.ok;
  };
}
