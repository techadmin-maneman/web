// Everything the handlers use to reach outside the Worker: HTTP, the clock,
// the providers and alerts. Built once per invocation from the validated
// config; tests pass their own.

import type { StaticConfig } from "./guard.ts";
import type { Logger } from "./log.ts";
import { createAlert, type Alert } from "./providers/alerts.ts";
import { createCrmProvider, type CrmProvider } from "./providers/crm.ts";
import { createImageProvider, type ImageProvider } from "./providers/image.ts";
import { createMessagingProvider, type MessagingProvider } from "./providers/messaging.ts";

export interface Dependencies {
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly crm: CrmProvider;
  readonly image: ImageProvider;
  readonly messaging: MessagingProvider;
  readonly alert: Alert;
}

export type DependencyFactory = (env: Env, log: Logger) => Dependencies;

export function productionDependencies(config: StaticConfig): DependencyFactory {
  const { settings } = config;
  return (env, log) => {
    // A bare reference to the global fetch throws "Illegal invocation" in Workers when called as a method.
    const httpFetch: typeof fetch = (input, init) => fetch(input, init);
    const now = (): Date => new Date();
    return {
      fetch: httpFetch,
      now,
      crm: createCrmProvider(settings.zoho, { db: env.DB, fetch: httpFetch, now, log }),
      image: createImageProvider(settings.tryon.ailabApiKey, { fetch: httpFetch, now }),
      messaging: createMessagingProvider(settings.messaging.evolution, { fetch: httpFetch, log }),
      alert: createAlert({
        webhookUrl: settings.alertWebhookUrl,
        environment: config.environment,
        fetch: httpFetch,
        log,
      }),
    };
  };
}
