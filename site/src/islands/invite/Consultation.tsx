import { useState } from "preact/hooks";
import type { LossExtent } from "../../../../src/config/booking.ts";
import { ONE_VISIT_WINDOWS } from "../../../../src/policy/one-visit.ts";
import { referral } from "../../content/referral.ts";
import { numberCode as numberCodeWords } from "../../content/site.ts";
import { track } from "../../lib/analytics.ts";
import {
  addressToSend,
  emptyAddress,
  missingParts,
  partsToMark,
  REQUIRED_API_FIELDS,
  type AddressFields,
} from "../../lib/address.ts";
import {
  bookConsultation,
  bookPublicConsultation,
  type Consultation as PublicConsultation,
  type ErrorCode,
  type ReferralConsultation,
} from "../../lib/api.ts";
import { dayStrip, indiaTomorrow } from "../../lib/dates.ts";
import { anyOpen, chosenSlot, type Slot } from "../../lib/open-windows.ts";
import { forgetInvite, rememberedInvite } from "../../lib/remembered-invite.ts";
import { fill } from "../../lib/text.ts";
import { NumberCodeField, type CodeFieldClasses } from "../NumberCodeField.tsx";
import { useNumberCode } from "../useNumberCode.ts";
import { AddressFieldset } from "./AddressFieldset.tsx";
import { DayStrip, DiscountCode, PlanChoice, WindowChoice } from "./ConsultationFields.tsx";
import type { Booking } from "./Done.tsx";
import { ExtentFieldset, ForPincode, PersonFieldset, RememberedInvite, Send, type FormProps } from "./fields.tsx";
import styles from "./Invite.module.css";
import { codeInPath, hairSystemsInPage } from "./page.ts";
import { byDoor, leadSent } from "./submit.ts";
import { useOpenWindows } from "./useOpenWindows.ts";
import { mobileToSend, PERSON_FIELDS, useTurnstileForm } from "./useTurnstileForm.ts";
import { isOneOf } from "../../../../src/lib/one-of.ts";
import { BOOKING_DAYS } from "../../../../src/config/scheduling.ts";

type BookingWindow = ReferralConsultation["window"];
export type Plan = "consultation" | "one_visit";

interface ConsultationProps extends FormProps {
  /** What the form books, which the page's heading follows. */
  plan: Plan;
  onPlanChange: (plan: Plan) => void;
  onBooked: (booking: Booking) => void;
}

/** Whether a consultation and fit in one visit can start in a window: the morning or the afternoon. */
const oneVisitStartsIn = (window: BookingWindow): boolean => isOneOf(ONE_VISIT_WINDOWS, window);

/** The WhatsApp code's field, on this form's paper. */
const CODE_FIELD: CodeFieldClasses = {
  label: styles.label,
  input: styles.input,
  bad: styles.bad,
  hint: styles.hint,
  error: styles.error,
  again: styles.change,
};

/** The button's words: what the plan books, or, once a code is on its way, confirming it. */
function submitLabel(plan: Plan, codeWaiting: boolean): string {
  const { consultation } = referral;
  if (codeWaiting) return consultation.confirmOneVisit;
  return plan === "one_visit" ? consultation.submitOneVisit : consultation.submit;
}

/** The fields this form marks when a refusal names them, by the API's names. */
const MARKED_FIELDS: readonly string[] = [...PERSON_FIELDS, ...REQUIRED_API_FIELDS, "discount_code"];

/** Whether a refusal means the strip is out of date: a window filled, or a day closed, since it was drawn. */
const outOfDate = (code: ErrorCode | "network"): boolean => code === "taken" || code === "not_bookable";

/**
 * The pincode is served, so the page books a free consultation. The form also takes the address the
 * consultation is at, which no board draws, so nothing is booked without one (ADR 0081). It may book the
 * consultation and fit in one visit instead, which no board draws either: three hours, in the morning or the
 * afternoon, paid for once the client is fitted (ADR 0105), and, on the site's own page, with a discount code that
 * comes off the hair system's price when they pay (ADR 0108). That one is booked only once the WhatsApp code sent to
 * the number has been entered.
 */
export function Consultation(props: ConsultationProps) {
  const form = useTurnstileForm(props.turnstileSiteKey, MARKED_FIELDS);
  const numberCode = useNumberCode();
  const { plan } = props;
  // Offered while ops offer a hair system to fit. A page with no word of it offers it, and the API refuses it if not.
  const [oneVisitOffered] = useState(() => hairSystemsInPage() !== false);
  const [picked, setPicked] = useState<Slot>(() => ({ date: indiaTomorrow(), window: "morning" }));
  const [address, setAddress] = useState<AddressFields>(() => emptyAddress(props.answer.city));
  const [extent, setExtent] = useState<LossExtent | null>(null);
  const [code, setCode] = useState("");
  // On /book, the invite this browser remembers: the form says who is told of the fit before it sends it.
  const [remembered, setRemembered] = useState(() => (props.invited ? null : rememberedInvite()));
  const { pincode } = props.answer;
  const open = useOpenWindows(pincode, plan);
  const { consultation } = referral;
  const windows = consultation.windows.filter((option) => plan === "consultation" || oneVisitStartsIn(option.id));
  const windowIds = windows.map((option) => option.id);
  // The visitor's pick while it is open; else the nearest open window.
  const slot = chosenSlot(open.days, windowIds, picked);
  const days = dayStrip(open.days?.[0]?.date ?? indiaTomorrow(), open.days?.length ?? BOOKING_DAYS);
  // The site's own page takes a discount code for the one visit; an invite's page is the invite's offer (ADR 0108).
  const takesCode = plan === "one_visit" && !props.invited;
  const sentCode = takesCode && code.trim() !== "" ? code.trim() : null;
  const codeRefused = takesCode && form.refusedFields.includes("discount_code");

  const digits = mobileToSend(form.fields);
  const addressComplete = missingParts(address).length === 0;
  const addressBad = partsToMark(address, form.touched, form.refusedFields);
  const marked = addressBad.length + form.personBad.length + (codeRefused ? 1 : 0);
  // The one visit is booked only for a number its WhatsApp code proved.
  const codeWaiting = plan === "one_visit" && numberCode.waitingFor(digits);

  function submit(event: Event) {
    if (plan === "one_visit") void bookOneVisit(event);
    else book(event, null);
  }

  /** The one visit: a code to the number first, then the booking once the code is entered. */
  async function bookOneVisit(event: Event) {
    const proved = numberCode.proofFor(digits);
    if (proved !== null) {
      book(event, proved);
      return;
    }
    if (!numberCode.waitingFor(digits)) {
      askForCode(event);
      return;
    }
    event.preventDefault();
    const entered = await numberCode.confirm();
    if (entered !== null) book(event, entered);
  }

  function askForCode(event: Event) {
    const name = form.fields.name.trim();
    void form.submit(
      event,
      (token) => numberCode.ask(digits, name, token),
      () => undefined,
      addressComplete,
    );
  }

  function book(event: Event, numberCodeId: string | null) {
    const { fields } = form;
    const request = {
      name: fields.name.trim(),
      mobile: mobileToSend(fields),
      pincode,
      date: slot.date,
      window: slot.window,
      address: addressToSend(address, pincode),
      ...(plan === "one_visit" ? { one_visit: true } : {}),
      ...(numberCodeId === null ? {} : { number_code_id: numberCodeId }),
      consent: true as const,
    };
    const door = { invited: props.invited, credits: props.credits, extent, remembered };
    const { onInvite, onBook: onSite } = byDoor(request, door);
    const onBook = { ...onSite, ...(sentCode === null ? {} : { discount_code: sentCode }) };
    const send = (token: string, keyFor: (request: unknown) => string) =>
      props.invited
        ? bookConsultation(codeInPath(), { ...onInvite, turnstile_token: token }, keyFor(onInvite))
        : bookPublicConsultation({ ...onBook, turnstile_token: token }, keyFor(onBook));
    void form.submit<ReferralConsultation | PublicConsultation>(
      event,
      async (token, keyFor) => {
        const answer = await send(token, keyFor);
        // A code entered more than 30 minutes ago no longer proves the number: the next press sends a new one.
        if (!answer.ok && answer.code === "number_not_proved") numberCode.forget();
        if (!answer.ok && outOfDate(answer.code)) void open.refresh();
        return answer;
      },
      (booked) => {
        const page = leadSent(door, { served: true, area: props.answer.area, window: slot.window });
        track({ name: "booking_confirmed", page, area: booked.area, window: booked.window, state: booked.state });
        props.onBooked({ result: booked, mobile: fields.mobile, code: sentCode });
      },
      addressComplete,
    );
  }

  function bookWithoutInvite() {
    if (remembered !== null) forgetInvite(remembered);
    setRemembered(null);
  }

  return (
    <form ref={form.element} class={styles.form} onSubmit={submit} noValidate>
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

      <PlanChoice plan={plan} oneVisitOffered={oneVisitOffered} onPlanChange={props.onPlanChange} />

      {takesCode && <DiscountCode code={code} refused={codeRefused} onCode={setCode} />}

      <DayStrip
        days={days}
        slot={slot}
        open={open.days}
        windowIds={windowIds}
        nothingOpen={!anyOpen(open.days, windowIds)}
        onDay={(date) => {
          setPicked({ date, window: slot.window });
        }}
      />

      <WindowChoice
        windows={windows}
        slot={slot}
        open={open.days}
        onWindow={(window) => {
          setPicked({ date: slot.date, window });
        }}
      />

      <AddressFieldset
        address={address}
        missing={addressBad}
        pincode={pincode}
        idPrefix="invite-consultation"
        onChange={setAddress}
      />

      {!props.invited && <ExtentFieldset extent={extent} onChange={setExtent} />}

      <PersonFieldset
        fields={form.fields}
        bad={form.personBad}
        idPrefix="invite-consultation"
        consentLabel={consultation.consent}
        consentNote=""
        onChange={form.setFields}
      />

      {remembered !== null && (
        <RememberedInvite
          line={referral.remembered.consultation(props.reward)}
          without={referral.remembered.bookWithout}
          onWithout={bookWithoutInvite}
        />
      )}

      {codeWaiting && (
        <NumberCodeField
          idPrefix="invite-number"
          mobile={form.fields.mobile}
          code={numberCode.code}
          failure={numberCode.failure}
          classes={CODE_FIELD}
          onInput={numberCode.setCode}
          onAgain={askForCode}
        />
      )}

      <div ref={form.box} class={styles.turnstile} />
      <Send
        failure={form.failure}
        marked={marked}
        sending={form.sending || numberCode.checking}
        label={submitLabel(plan, codeWaiting)}
        sendingLabel={numberCode.checking ? numberCodeWords.checking : consultation.sending}
      />
      {props.credits && <p class={styles.told}>{consultation.told(props.name, props.reward)}</p>}
    </form>
  );
}
