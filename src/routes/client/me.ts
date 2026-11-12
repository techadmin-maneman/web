// GET /api/me: the client app's Home card. A client is fitted once a first fit or a later visit is
// done; a lead has a consultation, booked, or from their booking on the site
// while it is not yet a visit; else nothing is booked. The next visit comes
// from the visits, and
// the credit tile, Home's one prompt and the invoice line beneath it (src/domain/clients/home-prompt.ts).
// What the client may book now is every service offered of each kind open to
// them, for the booking sheet to offer (docs/decisions/0085-services-ops-can-edit.md).
//
// A visit paid for, or booked free, that is not booked yet, its request having
// failed part-way, is said to be on its way, neither booked nor refunded, until
// the cron books it (docs/decisions/0068-a-paid-hold-is-kept.md).
//
// With nothing booked, it says what the app offers next, which the booking
// sheet opens pre-filled with: the first fit once the consultation is done, or
// the next service once a visit is (docs/decisions/0086-the-next-visit-is-offered.md),
// each as one of the services ops offer.

import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { WindowLabel } from "../../config/booking.ts";
import type { BookingWindow } from "../../config/scheduling.ts";
import type { VisitType } from "../../config/visit-types.ts";
import { bookableTypes } from "../../domain/booking/availability.ts";
import { bookingUnderWay, type BookingUnderWay } from "../../domain/booking/holds.ts";
import {
  askedFor,
  latestProposal,
  standingProposal,
  type Asked,
  type ProposedBooking,
} from "../../domain/booking/proposed-visits.ts";
import { offeredAmong, servicesOnDay } from "../../domain/booking/services.ts";
import { homePrompts, promptFacts, whatHomeOffers } from "../../domain/clients/home-prompt.ts";
import { currentAddress, liveContact } from "../../domain/clients/profile.ts";
import { spendableCredits } from "../../domain/money/credits.ts";
import { heldOneVisitPrice, owedPayments, requestedOneVisitPrice } from "../../domain/money/one-visit-money.ts";
import { pendingInviteOf } from "../../domain/referrals/referrals.ts";
import { canRefer, clientStateOf, isFitted, missedVisit, nextVisit } from "../../domain/visits/client-visits.ts";
import { consultationRecap } from "../../domain/visits/consultation-recap.ts";
import { nextVisitFacts } from "../../domain/visits/next-visit.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { MeSchema } from "../schemas/me.ts";
import type { OpsInputs } from "../../domain/platform/ops-settings.ts";
import { INVOICE_KEPT_YEARS } from "../../policy/retention.ts";
import { clientRoute } from "../../http/session-routes.ts";
import { addDays, indiaDate } from "../../lib/india-time.ts";
import { firstNameOf, initialsOf } from "../../lib/names.ts";
import { loadSlotSchedule, type SlotSchedule } from "../../domain/booking/slot-times.ts";
import { windowTimesOf } from "../../policy/slot-times.ts";
import { creditsBody } from "./refer.ts";
import { clientPackage } from "../../domain/clients/client-package.ts";
import { wornHairSystem } from "../../domain/clients/worn-hair-system.ts";
import { pricedFor } from "../../domain/booking/client-prices.ts";
import { forPackage } from "../../policy/services.ts";
import { cityOfPerson } from "../../domain/cities/cities.ts";
import { selfServeKinds } from "../../policy/self-serve.ts";

/** The words the first booked page had for a window. It had none for the afternoon. */
const FIRST_FORM_WORDS: Partial<Record<BookingWindow, WindowLabel>> = { morning: "before noon", evening: "after four" };

type Consultation = NonNullable<z.infer<typeof MeSchema>["consultation"]>;

/** Home's consultation card; a one visit asked for says what it costs once fitted. */
async function consultationOf(
  db: D1Database,
  proposal: ProposedBooking,
  asked: Asked,
  where: { readonly place: string; readonly schedule: SlotSchedule },
): Promise<Consultation> {
  const date = proposal.proposed_visit_date;
  const { place, schedule } = where;
  return {
    date,
    window: asked.window,
    hours: windowTimesOf(schedule.on(date))[asked.window],
    window_label: FIRST_FORM_WORDS[asked.window] ?? null,
    place,
    requested: asked.requested,
    one_visit: asked.oneVisit ? await requestedOneVisitPrice(db, date, asked.code) : null,
  };
}

/** A visit on its way to being booked; a one visit says what it costs once fitted. */
async function beingBookedBody(db: D1Database, underWay: BookingUnderWay | null) {
  if (underWay === null) return null;
  const { holdId, one_visit: oneVisit, ...booking } = underWay;
  return { ...booking, one_visit: oneVisit ? await heldOneVisitPrice(db, holdId, booking.date) : null };
}

const meRoute = clientRoute({
  method: "get",
  path: "/api/me",
  summary: "The Home card: who the client is and what is booked",
  responses: {
    200: { description: "The Home card", content: { "application/json": { schema: MeSchema } } },
    401: errorResponse("session_required"),
  },
});

/** The latest booking a form left, and that booking while it stands as the client's consultation. */
interface FormBooking {
  readonly booking: ProposedBooking | null;
  readonly proposal: ProposedBooking | null;
  /** Home's consultation card: the proposal's day, what it asked for, and where. */
  readonly card: Consultation | null;
}

async function formBookingOf(c: Context<AppEnv>, personId: string, today: string): Promise<FormBooking> {
  const db = c.env.DB;
  const booking = await latestProposal(db, personId);
  const proposal = await standingProposal(db, personId, booking, today);
  if (proposal === null) return { booking, proposal, card: null };

  const [asked, address, schedule] = await Promise.all([
    askedFor(db, personId, proposal),
    currentAddress(db, personId),
    loadSlotSchedule(db),
  ]);
  if (asked === null) {
    c.var.log.warn("consultation_window_unknown", { person_id: personId });
    return { booking, proposal, card: null };
  }
  const place = address === null ? (proposal.city ?? "") : `${address.locality}, ${address.city} ${address.pincode}`;
  return { booking, proposal, card: await consultationOf(db, proposal, asked, { place, schedule }) };
}

/** What Home's offer and prompt turn on: the figures ops set, then the client's facts, read together. */
async function homeFactsOf(c: Context<AppEnv>, personId: string, now: Date) {
  const inputs = await opsInputs(c);
  const days = inputs.nextVisitDays;
  const [next, prompt] = await Promise.all([
    nextVisitFacts(c.env.DB, personId, now, days),
    promptFacts(c.env.DB, personId, now, days),
  ]);
  return { days, referralReward: inputs.referralReward, next, prompt };
}

/** Care's hours, the fit guarantee and the account's promises, as ops set them, for the app's words. */
function promisesOf(inputs: OpsInputs) {
  const days = (hours: number) => Math.ceil(hours / 24);
  const { opens, closes, first_reply } = inputs.careHours;
  return {
    care_hours: { opens, closes, first_reply },
    guarantee_days: inputs.guaranteeDays,
    answers_within: {
      grievance_days: days(inputs.taskSlaHours.grievance),
      deletion_days: days(inputs.taskSlaHours.erasure_request),
      invoices_kept_years: INVOICE_KEPT_YEARS,
    },
  };
}

/** Their package's service visit and replacement, and each first fit priced for the hair system made to them. */
async function offeredServices(
  db: D1Database,
  of: {
    readonly personId: string;
    readonly tomorrow: string;
    readonly sold: { readonly city: string | null; readonly services: Awaited<ReturnType<typeof servicesOnDay>> };
    readonly types: VisitType[];
    readonly onPackage: string | null;
  },
) {
  const services = forPackage(offeredAmong(of.sold.services, of.tomorrow, of.types), of.onPackage);
  const priced = await pricedFor(db, services, { personId: of.personId, on: of.tomorrow, city: of.sold.city });
  return priced.map((service) => ({
    type: service.kind,
    tier: service.tier,
    name: service.name,
    description: service.description,
    minutes: service.minutes,
    price: service.price,
  }));
}

export function registerClientMe(app: App): void {
  app.openapi(meRoute, async (c) => {
    const personId = clientOf(c).subjectId;
    const db = c.env.DB;
    const now = c.var.deps.now();
    const today = indiaDate(now);
    const tomorrow = addDays(today, 1);

    // Each read is a trip to D1 and back, so the reads that need nothing from each other go together.
    const nameOnInvite = c.var.config.settings.referrerNameOnInvite;
    const missed = missedVisit(db, personId);
    const refers = canRefer(db, personId);
    const inputsRead = opsInputs(c);
    const [person, upcoming, underWay, credits, fitted, form, types, sold, home, invite, owed, recap, onPackage, worn] =
      await Promise.all([
        liveContact(db, personId),
        nextVisit(db, personId, now),
        bookingUnderWay(db, personId),
        spendableCredits(db, personId, now),
        isFitted(db, personId),
        formBookingOf(c, personId, today),
        inputsRead.then((inputs) => bookableTypes(db, personId, now, inputs.nextVisitDays)),
        cityOfPerson(db, personId).then(async (city) => ({ city, services: await servicesOnDay(db, tomorrow, city) })),
        homeFactsOf(c, personId, now),
        pendingInviteOf(db, personId, now, nameOnInvite),
        owedPayments(db, personId),
        consultationRecap(db, personId),
        clientPackage(db, personId),
        wornHairSystem(db, personId),
      ]);
    if (person === null) return refuse(c, "session_required");

    const { name } = person;
    const state = clientStateOf(fitted, upcoming !== null || form.booking !== null);
    // A form's consultation counts as booked while it stands, asked for or held.
    const booked = home.next.booked || upcoming !== null || form.proposal !== null;
    const { remake, offer } = whatHomeOffers(booked, home.prompt, home.next.offer);
    const offered = await offeredServices(db, { personId, tomorrow, sold, types, onPackage });
    const { prompt, invoice } = await homePrompts({
      db,
      personId,
      row: home.prompt,
      standing: { booked, offer },
      now,
      days: home.days,
    });
    const pendingInvite = fitted ? null : invite;

    return c.json(
      {
        state,
        refers: await refers,
        name,
        first_name: firstNameOf(name),
        initials: initialsOf(name),
        // A one visit on its way to being booked is shown as itself, not as the consultation it began as.
        consultation: underWay?.one_visit === true ? null : form.card,
        next_visit: upcoming,
        consulted: fitted ? null : recap,
        being_booked: await beingBookedBody(db, underWay),
        missed_visit: await missed,
        payment_owed: owed[0] ?? null,
        remake,
        credits: credits.visits > 0 ? creditsBody(credits) : null,
        prompt,
        invoice,
        booking: {
          self_serve: c.var.config.settings.selfServeBooking,
          self_serve_kinds: [...selfServeKinds(c.var.config.settings)],
          types,
          services: offered,
          next: offer,
        },
        ...promisesOf(await inputsRead),
        hair_system: worn,
        referral_reward: home.referralReward,
        pending_invite: pendingInvite === null ? null : { referrer_first_name: pendingInvite.referrerFirstName },
      },
      200,
    );
  });
}
