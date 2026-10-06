// What the visit message tests share (visit-messages.test.ts, visit-message-text.test.ts): the client, their visit and
// payment, their consent, and the messages written for them.

import { env } from "cloudflare:workers";
import type { Settings } from "../../../src/config/settings.ts";
import type { StaticConfig } from "../../../src/guard.ts";
import { createLogger } from "../../../src/log.ts";
import { LOCAL_CONFIG, LOCAL_SETTINGS, NOW } from "../helpers.ts";

export const PERSON = "11111111-1111-4111-8111-111111111111";

export const VISIT = "22222222-2222-4222-8222-222222222222";

export const PAYMENT = "33333333-3333-4333-8333-333333333333";

/** Thursday 24 September, noon in India. */
export const THURSDAY_NOON = "2026-09-24T06:30:00.000Z";

export const log = createLogger();

export function config(messaging: Partial<Settings["messaging"]> = {}): StaticConfig {
  return { ...LOCAL_CONFIG, settings: { ...LOCAL_SETTINGS, messaging: { ...LOCAL_SETTINGS.messaging, ...messaging } } };
}

export async function consent(granted: boolean, at = NOW.toISOString()) {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, 'whatsapp_visits', 'whatsapp-visits-v1', ?3, ?4)`,
  )
    .bind(crypto.randomUUID(), PERSON, granted ? 1 : 0, at)
    .run();
}

export async function visit(type = "service", start = THURSDAY_NOON, status = "scheduled") {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, synced_at)
     VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?5, 't1', ?6)`,
  )
    .bind(VISIT, PERSON, type, status, start, NOW.toISOString())
    .run();
}

export async function paid() {
  await env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
       status, captured_at, created_at, updated_at)
     VALUES (?1, 'MM-2026-0841', ?2, ?3, 'pay_visit', 200000, 'INR', 'upi', 'captured', ?4, ?4, ?4)`,
  )
    .bind(PAYMENT, PERSON, VISIT, NOW.toISOString())
    .run();
}

export const messages = () =>
  env.DB.prepare("SELECT kind, subject_id, state FROM outbound_messages ORDER BY created_at, rowid").all();
