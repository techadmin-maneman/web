// Sending the conversions waiting in their rows (docs/decisions/0288-attribution-and-conversions.md), a few at a
// time each cron run, to each platform that is on. A send is tried again later after a failure, a minute on and then
// longer each time, and given up after its tries; one the platform refused is given up at once, with its words. None
// is sent of a test record, of a client erased or who asked that nothing of theirs go to Google or Meta, or once it is
// older than the platform takes. What each platform is told is built from our own rows at the moment it is sent:
// the number and first name hashed, Meta's cookies and the address and browser of the client's latest touch that had
// them, and Google's click ID from the latest touch that carried one.

import { sha256Hex } from "../../lib/hash.ts";
import { ALERT_WORDS } from "../../config/alert-words.ts";
import type { AlertOnce, ResolveAlert } from "../platform/alerts.ts";
import { googlePhoneHash, metaFirstNameHash, metaPhoneHash } from "../../lib/ad-match.ts";
import { DAY_MS, MINUTE_MS } from "../../lib/durations.ts";
import type { Logger } from "../../log.ts";
import type { CallBudget } from "../../lib/call-budget.ts";
import type {
  BookedVia,
  ConversionPlatform,
  ConversionPlatforms,
  ConversionToSend,
  SendOutcome,
} from "../../providers/conversions/index.ts";

type Platform = "meta" | "google";

/** How long after its event each platform still takes it: Meta's site events a week, its store's 62 days; Google 90. */
const TAKEN_FOR_DAYS: Readonly<Record<Platform, Readonly<Record<ConversionToSend["event"], number>>>> = {
  meta: { lead_submit: 7, consult_booked: 7, consult_done: 62, first_fit_paid: 62, service_paid: 62 },
  google: { lead_submit: 0, consult_booked: 90, consult_done: 90, first_fit_paid: 90, service_paid: 90 },
};

/** How long each try after a failure waits, in minutes: the last given up after. */
const WAITS_MINUTES = [1, 5, 30, 120, 720] as const;

/** How long a platform that refuses our account is left before its conversions are tried again. */
const HELD_MINUTES = 60;

/** Each platform's name in the alert its refusal raises. */
const PLATFORM_NAMES: Readonly<Record<Platform, string>> = { meta: "Meta", google: "Google Ads" };

/** How many of each platform's sends one run makes at most. */
const PER_RUN = 25;

/**
 * How long after an event it may be recorded and still be sent: one recorded later than this is history the release
 * found (a visit written again for the first time since), which those clients were never told would be shared.
 */
const RECORDED_LATE_DAYS = 7;

/** How far back a click ID or a browser's cookies still say something of a conversion: Google's click window. */
const LOOKBACK_DAYS = 90;

interface Due {
  readonly event_id: string;
  readonly event: ConversionToSend["event"];
  readonly subject_id: string;
  readonly person_id: string;
  readonly occurred_at: string;
  /** A payment's value as it stands when sent, before GST: a payment link's is filled in just after it is recorded. */
  readonly value_paise: number | null;
  readonly source_url: string | null;
  readonly created_at: string;
  readonly tries: number;
  readonly mobile_e164: string;
  readonly name: string;
  readonly test_record: number;
  readonly erased_at: string | null;
  readonly sharing_stopped_at: string | null;
}

interface Browser {
  readonly fbc: string | null;
  readonly fbp: string | null;
  readonly client_ip: string | null;
  readonly user_agent: string | null;
}

interface Clicks {
  readonly gclid: string | null;
  readonly gbraid: string | null;
  readonly wbraid: string | null;
}

/** Each platform's sends falling due, the oldest first. */
const DUE_META = `SELECT c.event_id, c.event, c.subject_id, c.person_id, c.occurred_at,
    CASE WHEN c.event IN ('first_fit_paid', 'service_paid')
      THEN (SELECT COALESCE(y.amount_ex_gst, y.amount) FROM payments y WHERE y.id = c.subject_id) ELSE c.value_paise END
      AS value_paise, c.source_url, c.created_at, c.meta_tries AS tries, p.mobile_e164, p.name, p.test_record, p.erased_at,
    pa.sharing_stopped_at
  FROM conversions c JOIN people p ON p.id = c.person_id LEFT JOIN person_attribution pa ON pa.person_id = c.person_id
  WHERE c.meta_state = 'pending' AND c.meta_next_at <= ?1
  ORDER BY c.meta_next_at LIMIT ?2`;
const DUE_GOOGLE = `SELECT c.event_id, c.event, c.subject_id, c.person_id, c.occurred_at,
    CASE WHEN c.event IN ('first_fit_paid', 'service_paid')
      THEN (SELECT COALESCE(y.amount_ex_gst, y.amount) FROM payments y WHERE y.id = c.subject_id) ELSE c.value_paise END
      AS value_paise, c.source_url, c.created_at, c.google_tries AS tries, p.mobile_e164, p.name, p.test_record, p.erased_at,
    pa.sharing_stopped_at
  FROM conversions c JOIN people p ON p.id = c.person_id LEFT JOIN person_attribution pa ON pa.person_id = c.person_id
  WHERE c.google_state = 'pending' AND c.google_next_at <= ?1
  ORDER BY c.google_next_at LIMIT ?2`;

/** Every conversion of a platform that is due by ?2, put off until ?1: the platform refuses our account. */
const HOLD_META = "UPDATE conversions SET meta_next_at = ?1 WHERE meta_state = 'pending' AND meta_next_at <= ?2";
const HOLD_GOOGLE =
  "UPDATE conversions SET google_next_at = ?1 WHERE google_state = 'pending' AND google_next_at <= ?2";

/** A send's outcome on its platform's columns, while it is still waiting. */
const WRITE_META = `UPDATE conversions SET meta_state = ?2, meta_tries = meta_tries + ?3,
    meta_error = ?4, meta_next_at = ?5, meta_sent_at = ?6
  WHERE event_id = ?1 AND meta_state = 'pending'`;
const WRITE_GOOGLE = `UPDATE conversions SET google_state = ?2, google_tries = google_tries + ?3,
    google_error = ?4, google_next_at = ?5, google_sent_at = ?6
  WHERE event_id = ?1 AND google_state = 'pending'`;

/**
 * The browser's cookies, address and agent: the lead's own touch for a lead, else the client's latest that had any,
 * before the event and within the lookback, and after the last time before it they declined the cookie bar: a Decline
 * keeps what came before it from being sent too.
 */
async function browserOf(db: D1Database, due: Due, since: string): Promise<Browser | null> {
  const has = "(t.fbc IS NOT NULL OR t.fbp IS NOT NULL OR t.client_ip IS NOT NULL OR t.user_agent IS NOT NULL)";
  if (due.event === "lead_submit") {
    return db
      .prepare(
        `SELECT t.fbc, t.fbp, t.client_ip, t.user_agent FROM leads l JOIN touches t ON t.id = l.touch_id
         WHERE l.id = ?1`,
      )
      .bind(due.subject_id)
      .first<Browser>();
  }
  return db
    .prepare(
      `SELECT t.fbc, t.fbp, t.client_ip, t.user_agent FROM touches t
       WHERE t.person_id = ?1 AND t.at <= ?2 AND t.at >= ?3 AND ${has}
         AND t.at > COALESCE((SELECT MAX(d.at) FROM touches d
           WHERE d.person_id = ?1 AND d.ad_consent = 'denied' AND d.at <= ?2), '')
       ORDER BY t.at DESC LIMIT 1`,
    )
    .bind(due.person_id, due.occurred_at, since)
    .first<Browser>();
}

/** Google's click IDs from the client's latest touch that carried one, before the event and within the lookback. */
const clicksOf = (db: D1Database, due: Due, since: string): Promise<Clicks | null> =>
  db
    .prepare(
      `SELECT t.gclid, t.gbraid, t.wbraid FROM touches t
       WHERE t.person_id = ?1 AND t.at <= ?2 AND t.at >= ?3
         AND (t.gclid IS NOT NULL OR t.gbraid IS NOT NULL OR t.wbraid IS NOT NULL)
       ORDER BY t.at DESC LIMIT 1`,
    )
    .bind(due.person_id, due.occurred_at, since)
    .first<Clicks>();

/**
 * How a booking was made: on the site or the app, as its hold says; else in the chat or the call the client's latest
 * touch before it was; else by ops alone. Null for any other event.
 */
async function bookedViaOf(db: D1Database, due: Due): Promise<BookedVia | null> {
  if (due.event !== "consult_booked") return null;
  const row = await db
    .prepare(
      `SELECT (SELECT h.booked_from FROM slot_holds h WHERE h.appointment_id = ?1 ORDER BY h.created_at LIMIT 1)
           AS booked_from,
         (SELECT t.via FROM touches t WHERE t.person_id = ?2 AND t.at <= ?3 ORDER BY t.at DESC, t.rowid DESC LIMIT 1)
           AS last_via`,
    )
    .bind(due.subject_id, due.person_id, due.occurred_at)
    .first<{ booked_from: string | null; last_via: string | null }>();
  if (row?.booked_from === "site" || row?.booked_from === "app") return "website";
  if (row?.last_via === "whatsapp") return "chat";
  return row?.last_via === "call" ? "phone_call" : "system";
}

/** What the platform is told of the conversion, built from our rows now. */
async function toSend(db: D1Database, due: Due, bookingPage: string): Promise<ConversionToSend> {
  const occurredAt = new Date(due.occurred_at);
  const since = new Date(occurredAt.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString();
  const [browser, clicks, metaPhone, googlePhone, firstName, externalId, bookedVia] = await Promise.all([
    browserOf(db, due, since),
    clicksOf(db, due, since),
    metaPhoneHash(due.mobile_e164),
    googlePhoneHash(due.mobile_e164),
    metaFirstNameHash(due.name),
    sha256Hex(due.person_id),
    bookedViaOf(db, due),
  ]);
  return {
    eventId: due.event_id,
    event: due.event,
    occurredAt,
    value: due.value_paise === null ? null : due.value_paise / 100,
    sourceUrl: bookedVia === "website" ? bookingPage : due.source_url,
    bookedVia,
    phone: { meta: metaPhone, google: googlePhone },
    firstName,
    externalId,
    browser: {
      fbc: browser?.fbc ?? null,
      fbp: browser?.fbp ?? null,
      ip: browser?.client_ip ?? null,
      userAgent: browser?.user_agent ?? null,
    },
    clicks: { gclid: clicks?.gclid ?? null, gbraid: clicks?.gbraid ?? null, wbraid: clicks?.wbraid ?? null },
  };
}

/** Why a waiting conversion is not for the platform after all, or null where it is. */
function notFor(platform: Platform, due: Due, now: Date, sendsFrom: string | null): string | null {
  if (due.test_record === 1) return "test_record";
  if (due.erased_at !== null) return "erased";
  if (due.sharing_stopped_at !== null) return "sharing_stopped";
  if (sendsFrom !== null && due.occurred_at < sendsFrom) return "before_release";
  if (Date.parse(due.created_at) - Date.parse(due.occurred_at) > RECORDED_LATE_DAYS * DAY_MS) return "recorded_late";
  const days = TAKEN_FOR_DAYS[platform][due.event];
  return now.getTime() - Date.parse(due.occurred_at) > days * DAY_MS ? "too_old" : null;
}

/** The row's state after an outcome: sent; waiting again, a longer wait each try; or given up. */
function written(
  db: D1Database,
  send: { readonly platform: Platform; readonly due: Due; readonly now: Date },
  outcome: SendOutcome | { kind: "skipped"; why: string },
) {
  const { platform, due, now } = send;
  const at = now.toISOString();
  const set = (state: string, error: string | null, next: string | null, sentAt: string | null) =>
    (platform === "meta" ? db.prepare(WRITE_META) : db.prepare(WRITE_GOOGLE)).bind(
      due.event_id,
      state,
      outcome.kind === "skipped" || outcome.kind === "held" ? 0 : 1,
      error,
      next,
      sentAt,
    );
  if (outcome.kind === "skipped") return set("skipped", outcome.why, null, null);
  if (outcome.kind === "sent") return set("sent", null, null, at);
  if (outcome.kind === "held") {
    return set("pending", outcome.error, new Date(now.getTime() + HELD_MINUTES * MINUTE_MS).toISOString(), null);
  }
  const wait = WAITS_MINUTES[due.tries];
  if (outcome.kind === "refused" || wait === undefined) return set("failed", outcome.error, null, null);
  return set("pending", outcome.error, new Date(now.getTime() + wait * MINUTE_MS).toISOString(), null);
}

/** What a run needs: its time, its budget of outside calls, its log, and ops' alerts. */
interface Run {
  readonly now: Date;
  readonly budget: CallBudget;
  readonly log: Logger;
  readonly alerts: { readonly alertOnce: AlertOnce; readonly resolveAlert: ResolveAlert };
  /** The site's booking page, which a booking made on the site or the app is told as made on. */
  readonly bookingPage: string;
  /** The first instant sending began; what happened before it is never sent. Null for none. */
  readonly sendsFrom: string | null;
}

async function sendFor(
  db: D1Database,
  platform: Platform,
  sender: ConversionPlatform,
  run: Run,
): Promise<Record<string, number>> {
  const dueNow = platform === "meta" ? db.prepare(DUE_META) : db.prepare(DUE_GOOGLE);
  const { results } = await dueNow.bind(run.now.toISOString(), PER_RUN).all<Due>();
  const counted: Record<string, number> = {};
  for (const due of results) {
    const why = notFor(platform, due, run.now, run.sendsFrom);
    let outcome: SendOutcome | { kind: "skipped"; why: string };
    if (why !== null) outcome = { kind: "skipped", why };
    else {
      if (!run.budget.spend(platform === "google" ? 2 : 1)) break;
      outcome = await sender.send(await toSend(db, due, run.bookingPage));
    }
    await written(db, { platform, due, now: run.now }, outcome).run();
    counted[outcome.kind] = (counted[outcome.kind] ?? 0) + 1;
    if (outcome.kind === "refused")
      run.log.warn("conversion_refused", { platform, event: due.event, error: outcome.error });
    if (outcome.kind === "held") {
      // Every send would be refused the same way: the rest wait with it, and ops are told once.
      const until = new Date(run.now.getTime() + HELD_MINUTES * MINUTE_MS).toISOString();
      await (platform === "meta" ? db.prepare(HOLD_META) : db.prepare(HOLD_GOOGLE))
        .bind(until, run.now.toISOString())
        .run();
      run.log.warn("conversions_held", { platform, error: outcome.error });
      await run.alerts.alertOnce({
        key: `conversions_held:${platform}`,
        message: ALERT_WORDS.conversions_held({ platform: PLATFORM_NAMES[platform], error: outcome.error }),
      });
      break;
    }
  }
  if ((counted.sent ?? 0) > 0) await run.alerts.resolveAlert(`conversions_held:${platform}`);
  return counted;
}

/** One run's sends, to each platform that is on; a platform that is off keeps its conversions waiting. */
export async function sendConversions(db: D1Database, platforms: ConversionPlatforms, run: Run): Promise<void> {
  for (const platform of ["meta", "google"] as const) {
    const sender = platforms[platform];
    if (sender === null) continue;
    const counted = await sendFor(db, platform, sender, run);
    if (Object.keys(counted).length > 0) run.log.info("conversions_sent", { platform, ...counted });
  }
}
