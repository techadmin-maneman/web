import { useState } from "preact/hooks";
import type { LossExtent } from "../../../../src/config/booking.ts";
import { ONE_VISIT_WINDOWS } from "../../../../src/policy/one-visit.ts";
import { referral } from "../../content/referral.ts";
import { track } from "../../lib/analytics.ts";
import { addressToSend, emptyAddress, missingParts, type AddressFields } from "../../lib/address.ts";
import { bookConsultation, bookPublicConsultation, type ReferralConsultation } from "../../lib/api.ts";
import { dayStrip, indiaTomorrow } from "../../lib/dates.ts";
import { mobileDigits } from "../../lib/phone.ts";
import { forgetInvite, rememberedInvite } from "../../lib/remembered-invite.ts";
import { fill } from "../../lib/text.ts";
import { readAttribution } from "../../lib/visit.ts";
import { AddressFieldset } from "./AddressFieldset.tsx";
import { placeOf, type Booking } from "./Done.tsx";
import { ExtentFieldset, ForPincode, PersonFieldset, Send, type FormProps } from "./fields.tsx";
import styles from "./Invite.module.css";
import { codeInPath } from "./page.ts";
import { useTurnstileForm } from "./useTurnstileForm.ts";

type BookingWindow = ReferralConsultation["window"];
type Plan = "consultation" | "one_visit";

/** Whether a consultation and fit in one visit can start in a window: the morning or the afternoon. */
const oneVisitStartsIn = (window: BookingWindow): boolean => (ONE_VISIT_WINDOWS as readonly string[]).includes(window);

/** How far ahead the date strip reaches, from tomorrow: src/config/scheduling.ts, BOOKING_DAYS. */
const DAYS = 14;

/**
 * Board C2: the pincode is served, so the page books a free consultation. The form also takes the address the
 * consultation is at, which no board draws, so nothing is booked without one (ADR 0081). It may book the
 * consultation and fit in one visit instead, which no board draws either: three hours, in the morning or the
 * afternoon, paid for once the client is fitted (ADR 0105), and, on the site's own page, with a discount code that
 * comes off the hair system's price when they pay (ADR 0108).
 */
export function Consultation(props: FormProps & { onBooked: (booking: Booking) => void }) {
  const form = useTurnstileForm(props.turnstileSiteKey);
  const [plan, setPlan] = useState<Plan>("consultation");
  const [date, setDate] = useState(indiaTomorrow());
  const [window, setWindow] = useState<BookingWindow>("morning");
  const [address, setAddress] = useState<AddressFields>(() => emptyAddress(props.answer.city));
  const [extent, setExtent] = useState<LossExtent>("crown");
  const [code, setCode] = useState("");
  const days = dayStrip(indiaTomorrow(), DAYS);
  const { pincode } = props.answer;
  // The site's own page takes a discount code for the one visit; an invite's page is the invite's offer (ADR 0108).
  const takesCode = plan === "one_visit" && !props.invited;

  function submit(event: Event) {
    const { fields } = form;
    const request = {
      name: fields.name.trim(),
      mobile: mobileDigits(fields.mobile),
      pincode,
      date,
      window,
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
      loss_extent: extent,
      ...(attribution === undefined ? {} : { attribution }),
      ...(remembered === null ? {} : { invite_code: remembered }),
      ...(takesCode && code.trim() !== "" ? { discount_code: code.trim() } : {}),
    };
    const invite = props.invited ? codeInPath() : remembered;
    void form.submit(
      event,
      (token, keyFor) =>
        props.invited
          ? bookConsultation(codeInPath(), { ...request, turnstile_token: token }, keyFor(request))
          : bookPublicConsultation({ ...onBook, turnstile_token: token }, keyFor(onBook)),
      (booked) => {
        const page = props.invited ? "invite" : "book";
        const loss_extent = props.invited ? null : extent;
        track({ name: "lead_submitted", page, served: true, area: props.answer.area, window, loss_extent });
        track({ name: "booking_confirmed", page, area: booked.area, window: booked.window, state: booked.state });
        if (invite !== null) forgetInvite(invite);
        props.onBooked({ result: booked, mobile: fields.mobile, place: placeOf(props.answer) });
      },
      missingParts(address).length === 0,
    );
  }

  const { consultation } = referral;
  const choices = consultation.plan;
  const windows = consultation.windows.filter(
    (option) => plan === "consultation" || oneVisitStartsIn(option.id as BookingWindow),
  );

  function choosePlan(chosen: Plan) {
    setPlan(chosen);
    // The one visit does not start in the evening: a window it cannot take is not kept for it.
    if (chosen === "one_visit" && !oneVisitStartsIn(window)) setWindow("morning");
  }
  return (
    <form class={styles.form} onSubmit={submit} noValidate>
      <div>
        {/* The site's own page is already headed with this; the invite's is not. */}
        {props.invited && <h2 class={styles.formTitle}>{consultation.title}</h2>}
        <p class={styles.formBody}>{consultation.body}</p>
        <ForPincode text={fill(consultation.forPincode, { pincode })} onChange={props.onChangePincode} />
      </div>

      <fieldset class={styles.group}>
        <legend class={`caps ${styles.legend}`}>{choices.legend}</legend>
        <div class={styles.windows}>
          {choices.options.map((option) => (
            <label key={option.id} class={`${styles.window} ${plan === option.id ? styles.windowOn : ""}`}>
              <input
                type="radio"
                name="plan"
                class="visually-hidden"
                checked={plan === option.id}
                onChange={() => {
                  choosePlan(option.id as Plan);
                }}
              />
              <span class={styles.windowLabel}>{option.label}</span>
            </label>
          ))}
        </div>
        {plan === "one_visit" && <p class={styles.planNote}>{choices.note}</p>}
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
        <div class={styles.dates}>
          {days.map((day) => (
            <label key={day.date} class={`${styles.day} ${date === day.date ? styles.dayOn : ""}`}>
              <input
                type="radio"
                name="date"
                class="visually-hidden"
                checked={date === day.date}
                onChange={() => {
                  setDate(day.date);
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
          {windows.map((option) => (
            <label key={option.id} class={`${styles.window} ${window === option.id ? styles.windowOn : ""}`}>
              <input
                type="radio"
                name="window"
                class="visually-hidden"
                checked={window === option.id}
                onChange={() => {
                  setWindow(option.id as BookingWindow);
                }}
              />
              <span class={styles.windowLabel}>{option.label}</span>
              <span class={styles.windowHours}>{option.hours}</span>
            </label>
          ))}
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
      {props.credits && (
        <p class={styles.told}>
          {props.name === null ? consultation.toldUnnamed : fill(consultation.told, { name: props.name })}
        </p>
      )}
    </form>
  );
}
