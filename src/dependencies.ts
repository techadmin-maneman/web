// Everything the handlers use to reach outside the Worker: HTTP, the clock,
// the providers and alerts. Built once per invocation from the validated
// config; tests pass their own.

import type { StaticConfig } from "./guard.ts";
import { createAccessVerifier, type AccessVerifier } from "./http/access.ts";
import type { Logger } from "./log.ts";
import { createAlert, createLeadNotice, type Alert, type LeadNotice } from "./providers/alerts.ts";
import { createBooksProvider, type BooksProvider } from "./providers/books.ts";
import { createCodeSender, type CodeSender } from "./providers/codes.ts";
import { createCrmProvider, type CrmProvider } from "./providers/crm.ts";
import { createFsmProvider, type FsmProvider } from "./providers/fsm.ts";
import { createImageProvider, type ImageProvider } from "./providers/image.ts";
import { createMessagingProvider, type MessagingProvider } from "./providers/messaging.ts";
import { createPaymentsProvider, type PaymentsProvider } from "./providers/razorpay.ts";
import { createGeocodeProvider, type GeocodeProvider } from "./providers/geocode.ts";

export interface Dependencies {
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly crm: CrmProvider;
  readonly image: ImageProvider;
  readonly messaging: MessagingProvider;
  readonly alert: Alert;
  /** Posts a new lead to the chat space. */
  readonly notifyLead: LeadNotice;
  /** Checks the Cloudflare Access token on the ops surface. */
  readonly access: AccessVerifier;
  /** Sends the client app's login codes. */
  readonly codes: CodeSender;
  /** Zoho FSM, the system of record for field work. */
  readonly fsm: FsmProvider;
  /** Zoho Books, for invoices and receipts. */
  readonly books: BooksProvider;
  /** Razorpay, for orders and refunds. */
  readonly payments: PaymentsProvider;
  /** The address search, and the coordinate the geofence measures against. */
  readonly geocode: GeocodeProvider;
}

export type DependencyFactory = (env: Env, log: Logger) => Dependencies;

export function productionDependencies(config: StaticConfig): DependencyFactory {
  const { settings } = config;
  // A bare reference to the global fetch throws "Illegal invocation" in Workers when called as a method.
  const httpFetch: typeof fetch = (input, init) => fetch(input, init);
  const now = (): Date => new Date();
  // Built once per isolate, so Access's signing keys are fetched once, not per request.
  const access = createAccessVerifier(settings.access, { fetch: httpFetch, now });
  return (env, log) => {
    const messaging = createMessagingProvider(settings.messaging.evolution, { fetch: httpFetch, log });
    return {
      fetch: httpFetch,
      now,
      crm: createCrmProvider(settings.zoho, { db: env.DB, fetch: httpFetch, now, log }),
      image: createImageProvider(settings.tryon.ailabApiKey, { fetch: httpFetch, now }),
      messaging,
      alert: createAlert({
        webhookUrl: settings.alertWebhookUrl,
        environment: config.environment,
        fetch: httpFetch,
        log,
      }),
      notifyLead: createLeadNotice({
        webhookUrl: settings.leadWebhookUrl,
        environment: config.environment,
        fetch: httpFetch,
        log,
      }),
      access,
      codes: createCodeSender(config.providers.SMS_PROVIDER, { messaging, log }),
      fsm: createFsmProvider(config.providers.FSM_PROVIDER, settings.zohoFsm, {
        db: env.DB,
        fetch: httpFetch,
        now,
        log,
      }),
      books: createBooksProvider(config.providers.BOOKS_PROVIDER, settings.zohoFsm, {
        db: env.DB,
        fetch: httpFetch,
        now,
        log,
      }),
      payments: createPaymentsProvider(config.providers.PAYMENTS_PROVIDER, settings.razorpay, {
        fetch: httpFetch,
        log,
      }),
      geocode: createGeocodeProvider(config.providers.GEOCODE_PROVIDER, settings.geocode.apiKey, { fetch: httpFetch }),
    };
  };
}
