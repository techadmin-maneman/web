import { useState } from "preact/hooks";
import type { LossExtent } from "../../../../src/config/booking.ts";
import { referral } from "../../content/referral.ts";
import { track } from "../../lib/analytics.ts";
import { bookConsultation, bookPublicConsultation, type ReferralConsultation } from "../../lib/api.ts";
import { dayStrip, indiaTomorrow } from "../../lib/dates.ts";
import { mobileDigits } from "../../lib/phone.ts";
import { fill } from "../../lib/text.ts";
import { readAttribution } from "../../lib/visit.ts";
import { placeOf, type Booking } from "./Done.tsx";
import { ExtentFieldset, ForPincode, PersonFieldset, Send, type FormProps } from "./fields.tsx";
import styles from "./Invite.module.css";
import { codeInPath } from "./page.ts";
import { useTurnstileForm } from "./useTurnstileForm.ts";

type BookingWindow = ReferralConsultation["window"];

/** How far ahead the date strip reaches, from tomorrow: src/config/scheduling.ts, BOOKING_DAYS. */
const DAYS = 14;

/** Board C2: the pincode is served, so the page books a free consultation. */
export function Consultation(props: FormProps & { onBooked: (booking: Booking) => void }) {
  const form = useTurnstileForm(props.turnstileSiteKey);
  const [date, setDate] = useState(indiaTomorrow());
  const [window, setWindow] = useState<BookingWindow>("morning");
  const [extent, setExtent] = useState<LossExtent>("crown");
  const days = dayStrip(indiaTomorrow(), DAYS);

  function submit(event: Event) {
    const { fields } = form;
    const request = {
      name: fields.name.trim(),
      mobile: mobileDigits(fields.mobile),
      pincode: props.answer.pincode,
      date,
      window,
      consent: true as const,
    };
    // The site's own page carries where this visit came from and where the hair loss is; the invite, the invite.
    const attribution = readAttribution();
    const onBook = { ...request, loss_extent: extent, ...(attribution === undefined ? {} : { attribution }) };
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
        const place = placeOf(props.answer);
        props.onBooked({ result: { credits: false, invite: "unknown", ...booked }, mobile: fields.mobile, place });
      },
    );
  }

  const { consultation } = referral;
  return (
    <form class={styles.form} onSubmit={submit} noValidate>
      <div>
        {/* The site's own page is already headed with this; the invite's is not. */}
        {props.invited && <h2 class={styles.formTitle}>{consultation.title}</h2>}
        <p class={styles.formBody}>{consultation.body}</p>
        <ForPincode
          text={fill(consultation.forPincode, { pincode: props.answer.pincode })}
          onChange={props.onChangePincode}
        />
      </div>

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
          {consultation.windows.map((option) => (
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
        label={consultation.submit}
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
