import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { useState } from "preact/hooks";
import type { LossExtent } from "../../../../src/config/booking.ts";
import { ONE_VISIT_WINDOWS } from "../../../../src/policy/one-visit.ts";
import { referral } from "../../content/referral.ts";
import { whatsapp } from "../../content/site.ts";
import { track } from "../../lib/analytics.ts";
import { addressToSend, emptyAddress, missingParts, type AddressFields } from "../../lib/address.ts";
import { bookConsultation, bookPublicConsultation, type ErrorCode, type ReferralConsultation } from "../../lib/api.ts";
import { dayStrip, indiaTomorrow, stripMonths } from "../../lib/dates.ts";
import { anyOpen, chosenSlot, dayOpen, isOpen, type Slot } from "../../lib/open-windows.ts";
import { forgetInvite, rememberedInvite } from "../../lib/remembered-invite.ts";
import { fill } from "../../lib/text.ts";
import { readAttribution } from "../../lib/visit.ts";
import { AddressFieldset } from "./AddressFieldset.tsx";
import type { Booking } from "./Done.tsx";
import { ExtentFieldset, ForPincode, PersonFieldset, Send, type FormProps } from "./fields.tsx";
import styles from "./Invite.module.css";
import { codeInPath, hairSystemsInPage } from "./page.ts";
import { useOpenWindows } from "./useOpenWindows.ts";
import { mobileToSend, useTurnstileForm } from "./useTurnstileForm.ts";

type BookingWindow = ReferralConsultation["window"];
export type Plan = "consultation" | "one_visit";

interface ConsultationProps extends FormProps {
  /** What the form books, which the page's heading follows. */
  plan: Plan;
  onPlanChange: (plan: Plan) => void;
  onBooked: (booking: Booking) => void;
}

/** Whether a consultation and fit in one visit can start in a window: the morning or the afternoon. */
const oneVisitStartsIn = (window: BookingWindow): boolean => (ONE_VISIT_WINDOWS as readonly string[]).includes(window);

/** How far ahead the date strip reaches, from tomorrow: src/config/scheduling.ts, BOOKING_DAYS. */
const DAYS = 14;

/** Whether a refusal means the strip is out of date: a window filled, or a day closed, since it was drawn. */
const outOfDate = (code: ErrorCode | "network"): boolean => code === "taken" || code === "not_bookable";

/**
 * Board C2: the pincode is served, so the page books a free consultation. The form also takes the address the
 * consultation is at, which no board draws, so nothing is booked without one (ADR 0081). It may book the
 * consultation and fit in one visit instead, which no board draws either: three hours, in the morning or the
 * afternoon, paid for once the client is fitted (ADR 0105), and, on the site's own page, with a discount code that
 * comes off the hair system's price when they pay (ADR 0108).
 */
export function Consultation(props: ConsultationProps) {
  const form = useTurnstileForm(props.turnstileSiteKey);
  const { plan } = props;
  // Offered while ops offer a hair system to fit. A page with no word of it offers it, and the API refuses it if not.
  const [oneVisitOffered] = useState(() => hairSystemsInPage() !== false);
  const [picked, setPicked] = useState<Slot>(() => ({ date: indiaTomorrow(), window: "morning" }));
  const [address, setAddress] = useState<AddressFields>(() => emptyAddress(props.answer.city));
  const [extent, setExtent] = useState<LossExtent | null>(null);
  const [code, setCode] = useState("");
  const { pincode } = props.answer;
  const open = useOpenWindows(pincode, plan);
  const { consultation } = referral;
  const windows = consultation.windows.filter(
    (option) => plan === "consultation" || oneVisitStartsIn(option.id as BookingWindow),
  );
  const windowIds = windows.map((option) => option.id as BookingWindow);
  // The visitor's pick while it is open; else the nearest open window.
  const slot = chosenSlot(open.days, windowIds, picked);
  const days = dayStrip(open.days?.[0]?.date ?? indiaTomorrow(), open.days?.length ?? DAYS);
  // The site's own page takes a discount code for the one visit; an invite's page is the invite's offer (ADR 0108).
  const takesCode = plan === "one_visit" && !props.invited;

  function submit(event: Event) {
    const { fields } = form;
    const request = {
      name: fields.name.trim(),
      mobile: mobileToSend(fields),
      pincode,
      date: slot.date,
      window: slot.window,
      address: addressToSend(address, pincode),
      ...(plan === "one_visit" ? { one_visit: true } : {}),
      consent: true as const,
    };
    // The site's own page carries where this visit came from, where the hair loss is, and the invite this browser
    // remembers; the invite's page, its own invite.
    const attribution = readAttribution();
    const remembered = props.invited ? null : rememberedInvite();
    const onBook = {
      ...request,
      ...(extent === null ? {} : { loss_extent: extent }),
      ...(attribution === undefined ? {} : { attribution }),
      ...(remembered === null ? {} : { invite_code: remembered }),
      ...(takesCode && code.trim() !== "" ? { discount_code: code.trim() } : {}),
    };
    const invite = props.invited ? codeInPath() : remembered;
    const book = (token: string, keyFor: (request: unknown) => string) =>
      props.invited
        ? bookConsultation(codeInPath(), { ...request, turnstile_token: token }, keyFor(request))
        : bookPublicConsultation({ ...onBook, turnstile_token: token }, keyFor(onBook));
    void form.submit(
      event,
      async (token, keyFor) => {
        const answer = await book(token, keyFor);
        if (!answer.ok && outOfDate(answer.code)) void open.refresh();
        return answer;
      },
      (booked) => {
        const page = props.invited ? "invite" : "book";
        const loss_extent = props.invited ? null : extent;
        const { area } = props.answer;
        track({ name: "lead_submitted", page, served: true, area, window: slot.window, loss_extent });
        track({ name: "booking_confirmed", page, area: booked.area, window: booked.window, state: booked.state });
        if (invite !== null) forgetInvite(invite);
        props.onBooked({ result: booked, mobile: fields.mobile });
      },
      missingParts(address).length === 0,
    );
  }

  const choices = consultation.plan;
  const options = choices.options.filter((option) => option.id === "consultation" || oneVisitOffered);
  const nothingOpen = !anyOpen(open.days, windowIds);

  return (
    <form class={styles.form} onSubmit={submit} noValidate>
      <div>
        {/* The site's own page is already headed and introduced; the invite's is not. */}
        {props.invited && (
          <>
            <h2 class={styles.formTitle}>{plan === "one_visit" ? consultation.titleOneVisit : consultation.title}</h2>
            <p class={styles.formBody}>{consultation.body}</p>
          </>
        )}
        <ForPincode text={fill(consultation.forPincode, { pincode })} onChange={props.onChangePincode} />
      </div>

      <fieldset class={styles.group}>
        <legend class={`caps ${styles.legend}`}>{choices.legend}</legend>
        <div class={styles.windows}>
          {options.map((option) => (
            <label key={option.id} class={`${styles.window} ${plan === option.id ? styles.windowOn : ""}`}>
              <input
                type="radio"
                name="plan"
                class="visually-hidden"
                checked={plan === option.id}
                onChange={() => {
                  props.onPlanChange(option.id as Plan);
                }}
              />
              <span class={styles.windowLabel}>{option.label}</span>
            </label>
          ))}
        </div>
        {plan === "one_visit" && <p class={styles.planNote}>{choices.note}</p>}
        {!oneVisitOffered && <p class={styles.planNote}>{choices.notYet}</p>}
      </fieldset>

      {takesCode && (
        <div>
          <label class={styles.label} for="invite-consultation-code">
            {consultation.code.label}
          </label>
          <input
            id="invite-consultation-code"
            class={styles.input}
            value={code}
            autocomplete="off"
            autocapitalize="characters"
            spellcheck={false}
            aria-describedby="invite-consultation-code-hint"
            onInput={(event) => {
              setCode(event.currentTarget.value);
            }}
          />
          <p id="invite-consultation-code-hint" class={styles.hint}>
            {consultation.code.hint}
          </p>
        </div>
      )}

      <fieldset class={styles.group}>
        <legend class={`caps ${styles.legend}`}>{consultation.date}</legend>
        {nothingOpen && (
          <p class={styles.planNote}>
            {consultation.noneOpen}{" "}
            <a href={whatsappChat(whatsapp.number)} target="_blank" rel="noopener">
              {consultation.noneOpenAction}
            </a>
          </p>
        )}
        <p class={styles.months}>{stripMonths(days)}</p>
        <div class={styles.dates}>
          {days.map((day) => (
            <label key={day.date} class={`${styles.day} ${slot.date === day.date ? styles.dayOn : ""}`}>
              <input
                type="radio"
                name="date"
                class="visually-hidden"
                aria-label={day.label}
                checked={slot.date === day.date}
                disabled={!dayOpen(open.days, day.date, windowIds)}
                onChange={() => {
                  setPicked({ date: day.date, window: slot.window });
                }}
              />
              <span class={styles.dayName}>{day.weekday}</span>
              <span class={styles.dayNumber}>{day.number}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset class={styles.group}>
        <legend class={`caps ${styles.legend}`}>{consultation.window}</legend>
        <div class={styles.windows}>
          {windows.map((option) => {
            const id = option.id as BookingWindow;
            const windowOpen = isOpen(open.days, slot.date, id);
            return (
              <label key={id} class={`${styles.window} ${slot.window === id ? styles.windowOn : ""}`}>
                <input
                  type="radio"
                  name="window"
                  class="visually-hidden"
                  checked={slot.window === id}
                  disabled={!windowOpen}
                  onChange={() => {
                    setPicked({ date: slot.date, window: id });
                  }}
                />
                <span class={styles.windowLabel}>{option.label}</span>
                <span class={styles.windowHours}>{windowOpen ? option.hours : consultation.full}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <AddressFieldset
        address={address}
        missing={form.touched ? missingParts(address) : []}
        pincode={pincode}
        idPrefix="invite-consultation"
        onChange={setAddress}
      />

      {!props.invited && <ExtentFieldset extent={extent} onChange={setExtent} />}

      <PersonFieldset
        fields={form.fields}
        touched={form.touched}
        idPrefix="invite-consultation"
        consentLabel={consultation.consent}
        consentNote=""
        onChange={form.setFields}
      />

      <div ref={form.box} class={styles.turnstile} />
      <Send
        failure={form.failure}
        sending={form.sending}
        label={plan === "one_visit" ? consultation.submitOneVisit : consultation.submit}
        sendingLabel={consultation.sending}
      />
      {props.credits && <p class={styles.told}>{consultation.told(props.name, props.reward)}</p>}
    </form>
  );
}
