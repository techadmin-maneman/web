// Booking a free consultation, and joining the waitlist where we do not come yet
// (docs/decisions/0051-booking-from-the-site.md). Two pages do this, and they do
// it the same way: the public site's /book, and a friend's invite at /r/:code.
// The only difference is the invite, which the landing passes and the site does not.
//
// Each booking leaves three records:
//
//   the slot,  held for the person and written to FSM from the fsm-sync queue;
//   the lead,  so the CRM funnel sees every booking, as it did in Phase 1;
//   the person and the consent they gave, under the notice they were shown.
//
// The slot is what the client sees; the lead is what ops sees. A waitlist entry
// leaves the lead and the entry, and no slot.

import type { Context } from "hono";
import type { AppEnv } from "../app.ts";
import type { LossExtent } from "../config/booking.ts";
import { CURRENT_NOTICE, LANDING_NOTICES } from "../config/notices.ts";
import { BOOKING_DAYS, HOLD_SECONDS, type BookingWindow } from "../config/scheduling.ts";
import { saltedHash } from "../lib/hash.ts";
import { addDays, indiaDate } from "../lib/india-time.ts";
import { toE164 } from "../lib/mobile.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import { takeOne } from "./rate-limit.ts";
import { attribute, type Invite } from "./referrals.ts";
import { holdSlot } from "./scheduling.ts";
import { saveBookingLead, type Attribution } from "./leads.ts";
import { checkTurnstile, visitorOf } from "../http/visitor.ts";

/** A pincode we know, and whether a technician works there. */
export interface Pincode {
  readonly pincode: string;
  readonly area: string;
  readonly city: string;
  readonly served: number;
}

export function pincodeOf(db: D1Database, pin: string): Promise<Pincode | null> {
  return db
    .prepare("SELECT pincode, area, city, served FROM serviceable_pincodes WHERE pincode = ?1")
    .bind(pin)
    .first<Pincode>();
}

/**
 * Why a submission was refused, in the codes the routes answer with. Each route
 * declares which statuses it can answer, so the type says which ones its caller
 * may see: only a booking can be too late for a window, or ask ops to take over.
 */
export interface Refusal<Status extends number = 400 | 403 | 409 | 422 | 429 | 503> {
  readonly ok: false;
  readonly status: Status;
  readonly code: "invalid_request" | "turnstile_failed" | "rate_limited" | "unavailable" | "taken" | "ops_assisted";
}

type Checked = { readonly ok: true; readonly mobile: string; readonly ipHash: string } | Refusal<400 | 403 | 429 | 503>;

/** The number, the Turnstile check and the daily limits, the same for both pages. */
export async function checkPerson(c: Context<AppEnv>, mobile: string, token: string): Promise<Checked> {
  const mobileE164 = toE164(mobile);
  if (mobileE164 === null) return { ok: false, status: 400, code: "invalid_request" };
  const visitor = await visitorOf(c);
  const turnstile = await checkTurnstile(c, token, visitor);
  if (turnstile === "rejected") return { ok: false, status: 403, code: "turnstile_failed" };
  if (turnstile === "unavailable") return { ok: false, status: 503, code: "unavailable" };
  const { settings } = c.var.config;
  const today = indiaDate(c.var.deps.now());
  const db = c.env.DB;
  const within =
    (await takeOne(db, {
      scope: "booking:mobile",
      key: await saltedHash(settings.ipHashSalt, `mobile:${mobileE164}`),
      window: today,
      limit: settings.leadMobileDailyLimit,
    })) &&
    (await takeOne(db, { scope: "booking:ip", key: visitor.ipHash, window: today, limit: settings.leadIpDailyLimit }));
  if (!within) return { ok: false, status: 429, code: "rate_limited" };
  return { ok: true, mobile: mobileE164, ipHash: visitor.ipHash };
}

/** The person with this number, made if new, and the consent they gave on the page. */
export async function personWith(
  db: D1Database,
  input: {
    mobile: string;
    name: string;
    purpose: "whatsapp_visits" | "contact";
    notice: string;
    ipHash: string;
    now: Date;
  },
): Promise<string> {
  const at = input.now.toISOString();
  const person = await db
    .prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES (?1, ?2, ?3, ?4, 1)
       ON CONFLICT (mobile_e164) DO UPDATE SET name = excluded.name, contactable = 1
       RETURNING id`,
    )
    .bind(crypto.randomUUID(), at, input.mobile, input.name)
    .first<{ id: string }>();
  if (person === null) throw new Error("the person was not written");
  await db
    .prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)`,
    )
    .bind(crypto.randomUUID(), person.id, input.purpose, input.notice, at, input.ipHash)
    .run();
  return person.id;
}

/** The city a lead may name: the pincode's, where we have it as a city of ours. */
async function leadCity(db: D1Database, city: string): Promise<string | null> {
  const row = await db.prepare("SELECT name FROM cities WHERE name = ?1").bind(city).first<{ name: string }>();
  return row?.name ?? null;
}

/**
 * The lead behind a booking or a waitlist entry, which is what reaches the CRM.
 * A Phase 2 form asks for neither the loss extent nor a rough window, so both may
 * be absent; the date it does have is the one the person booked.
 */
async function recordLead(
  c: Context<AppEnv>,
  input: {
    personId: string;
    name: string;
    mobile: string;
    pincode: Pincode | null;
    lossExtent: LossExtent | null;
    date: string | null;
    attribution: Attribution;
    ipHash: string;
    served: boolean;
    now: Date;
  },
): Promise<string> {
  const { log, requestId } = c.var;
  const db = c.env.DB;
  const leadId = crypto.randomUUID();
  await saveBookingLead(db, {
    leadId,
    newPersonId: input.personId,
    name: input.name,
    mobileE164: input.mobile,
    city: input.pincode === null ? null : await leadCity(db, input.pincode.city),
    source: input.served ? "form" : "waitlist",
    window: null,
    lossExtent: input.lossExtent,
    proposedVisitDate: input.date,
    attribution: input.attribution,
    ipHash: input.ipHash,
    requestId,
    now: input.now,
    // The consent was recorded with the notice the page showed, before this.
    recordConsent: false,
  });
  try {
    await c.env.CRM_QUEUE.send({ lead_id: leadId, request_id: requestId });
  } catch (error) {
    // The lead is safe in D1; the sweeper enqueues anything left pending.
    log.warn("crm_enqueue_failed", { lead_id: leadId, error });
  }
  return leadId;
}

export interface ConsultationRequest {
  readonly name: string;
  readonly mobile: string;
  readonly pincode: string;
  readonly date: string;
  readonly window: BookingWindow;
  readonly lossExtent: LossExtent | null;
  readonly turnstileToken: string;
  readonly attribution: Attribution;
  /** The invite the friend arrived with, where there is one. */
  readonly invite: Invite | null;
}

export interface Booked {
  readonly ok: true;
  readonly date: string;
  readonly window: BookingWindow;
  readonly area: string;
  /** Whether the invite's three service visits apply. */
  readonly credits: boolean;
}

/** Books the free consultation: the slot, the lead, and the invite's credits where they apply. */
export async function bookConsultation(c: Context<AppEnv>, request: ConsultationRequest): Promise<Booked | Refusal> {
  const { deps, log, requestId } = c.var;
  const db = c.env.DB;
  const now = deps.now();
  if (!c.var.config.settings.selfServeBooking) return { ok: false, status: 409, code: "ops_assisted" };

  const first = addDays(indiaDate(now), 1);
  const pincode = await pincodeOf(db, request.pincode);
  if (pincode?.served !== 1 || request.date < first || request.date > addDays(first, BOOKING_DAYS - 1)) {
    return { ok: false, status: 422, code: "invalid_request" };
  }
  const checked = await checkPerson(c, request.mobile, request.turnstileToken);
  if (!checked.ok) return checked;

  const personId = await personWith(db, {
    mobile: checked.mobile,
    name: request.name,
    purpose: "whatsapp_visits",
    notice: LANDING_NOTICES.consultation,
    ipHash: checked.ipHash,
    now,
  });
  const credits =
    request.invite !== null &&
    (await attribute(db, {
      invite: request.invite,
      personId,
      via: "consultation",
      pincode: request.pincode,
      now,
    }));

  const free = { amount_ex_gst: 0, amount: 0, gst_percent: 0 };
  const hold = await holdSlot(
    db,
    { personId, type: "consultation", date: request.date, window: request.window, price: free },
    now,
    HOLD_SECONDS,
  );
  if (hold === null) return { ok: false, status: 409, code: "taken" };
  await c.env.FSM_QUEUE.send({ hold_id: hold.id, request_id: requestId } satisfies FsmSyncMessage);

  const leadId = await recordLead(c, {
    personId,
    name: request.name,
    mobile: checked.mobile,
    pincode,
    lossExtent: request.lossExtent,
    date: request.date,
    attribution: request.attribution,
    ipHash: checked.ipHash,
    served: true,
    now,
  });
  log.info("consultation_booked", { hold_id: hold.id, lead_id: leadId, invited: request.invite !== null, credits });
  return { ok: true, date: request.date, window: request.window, area: pincode.area, credits };
}

export interface WaitlistRequest {
  readonly name: string;
  readonly mobile: string;
  readonly pincode: string;
  readonly lossExtent: LossExtent | null;
  readonly launchAlert: boolean;
  readonly turnstileToken: string;
  readonly attribution: Attribution;
  readonly invite: Invite | null;
}

export interface Listed {
  readonly ok: true;
  readonly area: string | null;
  readonly credits: boolean;
}

/** Takes the number for a pincode we do not serve yet, with the launch alert if it was asked for. */
export async function joinTheWaitlist(
  c: Context<AppEnv>,
  request: WaitlistRequest,
): Promise<Listed | Refusal<400 | 403 | 422 | 429 | 503>> {
  const { deps } = c.var;
  const db = c.env.DB;
  const now = deps.now();
  const pincode = await pincodeOf(db, request.pincode);
  if (pincode?.served === 1) return { ok: false, status: 422, code: "invalid_request" };
  const checked = await checkPerson(c, request.mobile, request.turnstileToken);
  if (!checked.ok) return checked;

  const personId = await personWith(db, {
    mobile: checked.mobile,
    name: request.name,
    purpose: "contact",
    notice: LANDING_NOTICES.waitlist,
    ipHash: checked.ipHash,
    now,
  });
  const at = now.toISOString();
  if (request.launchAlert) {
    await db
      .prepare(
        `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
         VALUES (?1, ?2, 'whatsapp_launches', ?3, 1, ?4, ?5)`,
      )
      .bind(crypto.randomUUID(), personId, CURRENT_NOTICE.whatsapp_launches, at, checked.ipHash)
      .run();
  }
  await db
    .prepare(
      `INSERT INTO waitlist_entries (id, pincode, person_id, referral_code, contact_consent_at, launch_alert,
         created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)
       ON CONFLICT (pincode, person_id) DO UPDATE SET launch_alert = MAX(launch_alert, excluded.launch_alert)`,
    )
    .bind(crypto.randomUUID(), request.pincode, personId, request.invite?.code ?? null, at, request.launchAlert ? 1 : 0)
    .run();
  const credits =
    request.invite !== null &&
    (await attribute(db, { invite: request.invite, personId, via: "waitlist", pincode: request.pincode, now }));

  await recordLead(c, {
    personId,
    name: request.name,
    mobile: checked.mobile,
    pincode,
    lossExtent: request.lossExtent,
    date: null,
    attribution: request.attribution,
    ipHash: checked.ipHash,
    served: false,
    now,
  });
  return { ok: true, area: pincode?.area ?? null, credits };
}
