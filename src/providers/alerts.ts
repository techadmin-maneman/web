// Alerts to a chat webhook (Slack, Google Chat or Discord). An alert must never
// break the work that raised it, so failures are logged, not thrown. Messages
// are scrubbed of phone numbers and e-mail addresses as a last defence; callers
// pass IDs, not personal data.

import { scrubString, type Logger } from "../log.ts";

const TIMEOUT_MS = 5_000;

export type Alert = (message: string) => Promise<void>;

export function createAlert(options: {
  webhookUrl: string | null;
  environment: string;
  fetch: typeof fetch;
  log: Logger;
}): Alert {
  const { webhookUrl, environment, fetch, log } = options;

  return async (message) => {
    const text = scrubString(`[mm-api ${environment}] ${message}`);
    log.warn("alert", { text });
    if (webhookUrl === null) return;

    // Discord reads "content"; Slack and Google Chat read "text" (and Google Chat rejects unknown keys).
    const body = new URL(webhookUrl).hostname.endsWith("discord.com") ? { content: text } : { text };
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) log.error("alert_not_delivered", { status: response.status });
    } catch (error) {
      log.error("alert_not_delivered", { error });
    }
  };
}
