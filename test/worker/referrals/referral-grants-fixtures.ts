// What the referral grant tests share (referral-grants*.test.ts): the referrer, the friend and the fit that earns the
// grant, an attribution, the referral jobs run, and what each reads back.

import { env } from "cloudflare:workers";
import { renderMessage } from "../../../src/config/message-templates.ts";
import { composeFriendCredited, composeReferralRejected } from "../../../src/domain/referrals/referral-messages.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { createLogger } from "../../../src/log.ts";
import { type ReferralReward } from "../../../src/policy/referral-reward.ts";
import { CRON_JOBS, runCronJobs } from "../../../src/scheduled/cron.ts";
import { fakeDependencies, fakeQueue, LOCAL_CONFIG, NOW } from "../helpers.ts";

export const REFERRER = "11111111-1111-4111-8111-111111111111";

export const FRIEND = "22222222-2222-4222-8222-222222222222";

export const FIT = "33333333-3333-4333-8333-333333333333";

export const ATTRIBUTION = "44444444-4444-4444-8444-444444444444";

export const CODE = "RM7K2Q";

export async function person(id: string, name: string, mobile: string) {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, NOW.toISOString(), mobile, name)
    .run();
}

export async function firstFit(
  id: string,
  personId: string,
  outcome: "done" | "partial" = "done",
  start = "2026-09-20T03:30:00.000Z",
) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
       fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, 'first_fit', 'completed', 'Completed', ?4, ?4, ?5, ?5)`,
  )
    .bind(id, `fsm-${id}`, personId, start, NOW.toISOString())
    .run();
  await env.DB.prepare("INSERT INTO visits (id, appointment_id, outcome, updated_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(crypto.randomUUID(), id, outcome, NOW.toISOString())
    .run();
}

export async function attribution(id: string, personId: string, via = "consultation", pincode: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, pincode, created_at,
       updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?4, ?4)`,
  )
    .bind(id, CODE, personId, "2026-09-01T06:30:00.000Z", via, pincode)
    .run();
}

export const openClientSession = (personId: string) =>
  openSession(env.DB, { kind: "client", subjectId: personId, deviceLabel: null, now: NOW });

export const state = async (id = ATTRIBUTION) =>
  (await env.DB.prepare("SELECT grant_state, fraud_signals FROM referral_attributions WHERE id = ?1")
    .bind(id)
    .first<{ grant_state: string; fraud_signals: string | null }>()) ?? null;

export const messagesWritten = async () =>
  (await env.DB.prepare("SELECT person_id, kind, subject_id FROM outbound_messages ORDER BY kind, person_id").all())
    .results;

/** What ops set in Settings · Rules, as the console writes it. */
export async function rewardSet(reward: ReferralReward) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO ops_settings (name, value, set_by, set_at) VALUES ('referral_reward', ?1, 'ops@localhost', ?2)",
  )
    .bind(JSON.stringify(reward), NOW.toISOString())
    .run();
}

/** The five-minute cron's referral pass, which reads what ops set as it runs. */
export async function referralsRun(now = NOW) {
  const queue = fakeQueue();
  await runCronJobs(
    CRON_JOBS.filter((job) => job.name === "referrals"),
    {
      env: { ...env, MESSAGE_QUEUE: queue },
      deps: fakeDependencies({ now: () => now }),
      config: LOCAL_CONFIG,
      log: createLogger(),
    },
  );
  return queue.sent;
}

export async function visitsConsent(personId: string, granted = true) {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, 'whatsapp_visits', 'referral-consultation-v1', ?3, ?4)`,
  )
    .bind(crypto.randomUUID(), personId, granted ? 1 : 0, NOW.toISOString())
    .run();
}

/** What the person's message of this kind about the referral says, or why it is not sent. */
export async function told(kind: "friend_credited" | "referral_rejected", personId: string) {
  const composed =
    kind === "friend_credited"
      ? await composeFriendCredited(env.DB, ATTRIBUTION, personId)
      : await composeReferralRejected(env.DB, ATTRIBUTION, personId);
  return "skip" in composed ? composed : renderMessage(composed.template, composed.params);
}
