// Everything the handlers use to reach outside the Worker: HTTP, the clock,
// the providers and alerts. Made for each invocation from the validated
// config, each provider when first used; tests pass their own.

import { createAlertOnce, createResolveAlert, type AlertOnce, type ResolveAlert } from "./domain/alerts.ts";
import type { StaticConfig } from "./guard.ts";
import { createAccessVerifier, type AccessVerifier } from "./providers/cloudflare-access.ts";
import type { Logger } from "./log.ts";
import { createAlert, createLeadNotice, type Alert, type LeadNotice } from "./providers/alerts.ts";
import { createBooksProvider, type BooksProvider } from "./providers/books.ts";
import { createCodeSender, type CodeSender } from "./providers/codes.ts";
import { createCrmProvider, type CrmProvider } from "./providers/crm.ts";
import { createFsmProvider, type FsmProvider } from "./providers/fsm.ts";
import { createImageProvider, type ImageProvider } from "./providers/image.ts";
import { createMessagingProvider, type MessagingProvider } from "./providers/messaging.ts";
import { createPaymentsProvider, type PaymentsProvider } from "./providers/payments.ts";
import { BACKGROUND_TIMEOUT_MS, WAITED_TIMEOUT_MS } from "./providers/zoho-http.ts";
import { createGeocodeProvider, type GeocodeProvider } from "./providers/geocode.ts";

export interface Dependencies {
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly crm: CrmProvider;
  readonly image: ImageProvider;
  readonly messaging: MessagingProvider;
  readonly alert: Alert;
  /** An alert kept in D1 and told once, with its IDs and console link (src/domain/alerts.ts). */
  readonly alertOnce: AlertOnce;
  /** Closes a kept alert, once what it was about is put right. */
  readonly resolveAlert: ResolveAlert;
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

/**
 * Who the calls are made for: a request someone is waiting on, or a queue
 * consumer or the cron, which nobody waits on. Zoho's calls in a request give
 * up sooner (src/providers/zoho-http.ts).
 */
export type Caller = "request" | "background";

export type DependencyFactory = (env: Env, log: Logger, caller?: Caller) => Dependencies;

/** Makes a value the first time it is asked for, and answers the same one after. */
function lazily<T>(make: () => T): () => T {
  let made: { readonly value: T } | undefined;
  return () => {
    made ??= { value: make() };
    return made.value;
  };
}

export function productionDependencies(config: StaticConfig): DependencyFactory {
  const { settings, providers, environment } = config;
  // A bare reference to the global fetch throws "Illegal invocation" in Workers when called as a method.
  const httpFetch: typeof fetch = (input, init) => fetch(input, init);
  const now = (): Date => new Date();
  // Built once per isolate, so Access's signing keys are fetched once, not per request.
  const access = createAccessVerifier(settings.access, { fetch: httpFetch, now });
  // Each provider is made the first time it is used. Making every one on every invocation was half the CPU time of a
  // cron run that had nothing to do (docs/decisions/0009, "the cron's CPU time").
  return (env, log, caller = "background") => {
    const zoho = {
      db: env.DB,
      fetch: httpFetch,
      now,
      log,
      timeoutMs: caller === "request" ? WAITED_TIMEOUT_MS : BACKGROUND_TIMEOUT_MS,
    };
    const messaging = lazily(() => createMessagingProvider(settings.messaging.evolution, { fetch: httpFetch, log }));
    const alert = lazily(() =>
      createAlert({ webhookUrl: settings.alertWebhookUrl, environment, fetch: httpFetch, log }),
    );
    const alertOnce = lazily(() => createAlertOnce({ db: env.DB, alert: alert(), now, environment, log }));
    const resolveAlert = lazily(() => createResolveAlert({ db: env.DB, now }));
    const notifyLead = lazily(() =>
      createLeadNotice({ webhookUrl: settings.leadWebhookUrl, environment, fetch: httpFetch, log }),
    );
    const crm = lazily(() => createCrmProvider(settings.zoho, zoho));
    const image = lazily(() => createImageProvider(settings.tryon.ailabApiKey, { fetch: httpFetch, now }));
    const codes = lazily(() => createCodeSender(providers.SMS_PROVIDER, { messaging: messaging(), log }));
    const fsm = lazily(() => createFsmProvider(providers.FSM_PROVIDER, settings.zohoFsm, zoho));
    const books = lazily(() => createBooksProvider(providers.BOOKS_PROVIDER, settings.zohoBooks, zoho));
    const payments = lazily(() =>
      createPaymentsProvider(providers.PAYMENTS_PROVIDER, settings.razorpay, { fetch: httpFetch, log }),
    );
    const geocode = lazily(() =>
      createGeocodeProvider(providers.GEOCODE_PROVIDER, settings.geocode.apiKey, { fetch: httpFetch }),
    );
    return {
      fetch: httpFetch,
      now,
      access,
      get crm() {
        return crm();
      },
      get image() {
        return image();
      },
      get messaging() {
        return messaging();
      },
      get alert() {
        return alert();
      },
      get alertOnce() {
        return alertOnce();
      },
      get resolveAlert() {
        return resolveAlert();
      },
      get notifyLead() {
        return notifyLead();
      },
      get codes() {
        return codes();
      },
      get fsm() {
        return fsm();
      },
      get books() {
        return books();
      },
      get payments() {
        return payments();
      },
      get geocode() {
        return geocode();
      },
    };
  };
}
