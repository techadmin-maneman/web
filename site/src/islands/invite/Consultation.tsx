import { useState } from "preact/hooks";
import type { LossExtent } from "@rules/config/booking.ts";
import { ONE_VISIT_WINDOWS } from "@rules/policy/one-visit.ts";
import { referral } from "../../content/referral.ts";
import { booking, numberCode as numberCodeWords } from "../../content/site.ts";
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
  type Code,
  type ReferralConsultation,
} from "../../lib/api.ts";
import { dayStrip, indiaTomorrow, type StripDay } from "../../lib/dates.ts";
import { anyOpen, chosenSlot, type Slot } from "../../lib/open-windows.ts";
import { forgetInvite, rememberedInvite } from "../../lib/remembered-invite.ts";
import { fill } from "../../lib/text.ts";
import { NumberCodeField, type CodeFieldClasses } from "../NumberCodeField.tsx";
import { useNumberCode } from "../useNumberCode.ts";
import { AddressFieldset } from "./AddressFieldset.tsx";
import { DayStrip, DayWindows, DiscountCode, PlanChoice } from "./ConsultationFields.tsx";
import type { Booking } from "./outcomes.ts";
import {
  ExtentFieldset,
  ForPincode,
  PersonFieldset,
  RememberedInvite,
  Send,
  StepLine,
  type FormProps,
} from "./fields.tsx";
import styles from "./Invite.module.css";
import { codeInPath } from "./page.ts";
import { byDoor, leadSent } from "./submit.ts";
import { useOpenWindows } from "./useOpenWindows.ts";
import { mobileToSend, PERSON_FIELDS, useTurnstileForm, type PersonFields } from "./useTurnstileForm.ts";
import { isOneOf } from "@rules/lib/one-of.ts";
import { BOOKING_DAYS } from "@rules/config/scheduling.ts";
import type { Plan } from "./flow.ts";

type BookingWindow = ReferralConsultation["window"];

interface ConsultationProps extends FormProps {
  /** What the form books, which the page's heading follows. */
  plan: Plan;
  onPlanChange: (plan: Plan) => void;
  onBooked: (booking: Booking) => void;
  /** On /book, the name and number its first step kept; an invite's page asks for them here. */
  person: PersonFields | null;
  /** On /book, which of its steps the form is at; an invite's page asks for everything at once. */
  stage: "all" | "visit" | "address";
  /** On /book, on from the visit to the address. */
  onNext: () => void;
  /** On /book, back from the address to the visit, as the browser's Back is: a window gone needs another. */
  onBackToVisit: () => void;
}

/** Whether a consultation and fit in one visit can start in a window: the morning or the afternoon. */
const oneVisitStartsIn = (window: BookingWindow): boolean => isOneOf(ONE_VISIT_WINDOWS, window);

/** The WhatsApp code's field, on this form's paper. */
const CODE_FIELD: CodeFieldClasses = { hint: styles.hint, error: styles.error, again: undefined };

/** The button's words: what the plan books, or, once a code is on its way, confirming it. */
function submitLabel(plan: Plan, codeWaiting: boolean): string {
  const { consultation } = referral;
  if (codeWaiting) return consultation.confirmOneVisit;
  return plan === "one_visit" ? consultation.submitOneVisit : consultation.submit;
}

/** The fields this form marks when a refusal names them, by the API's names; /book's name and number are its first step's. */
const MARKED_HERE: readonly string[] = [...REQUIRED_API_FIELDS, "discount_code"];
const MARKED_WITH_PERSON: readonly string[] = [...PERSON_FIELDS, ...MARKED_HERE];

/** Whether a refusal means the strip is out of date: a window filled, or a day closed, since it was drawn. */
const outOfDate = (code: Code): boolean => code === "taken" || code === "not_bookable";

/** The visit's part of the form: what it books, the day and the window. On /book, its third step. */
function VisitPart(
  props: ConsultationProps & {
    days: readonly StripDay[];
    slot: Slot;
    open: ReturnType<typeof useOpenWindows>["days"];
    windows: typeof referral.consultation.windows;
    nothingOpen: boolean;
    onPick: (slot: Slot) => void;
  },
) {
  const { plan, stage, slot } = props;
  const { consultation } = referral;
  const windowIds = props.windows.map((option) => option.id);
  return (
    <>
      <div>
        {stage === "visit" && <StepLine at={3} name={booking.steps.visit} focus={false} />}
        {/* The site's own page is already headed and introduced; the invite's is not. */}
        {props.invited && (
          <>
            <h2 class={styles.formTitle}>{plan === "one_visit" ? consultation.titleOneVisit : consultation.title}</h2>
            <p class={styles.formBody}>{consultation.body}</p>
          </>
        )}
        <ForPincode
          text={fill(consultation.forPincode, { pincode: props.answer.pincode })}
          onChange={props.onChangePincode}
        />
      </div>

      <PlanChoice plan={plan} onPlanChange={props.onPlanChange} />

      <DayStrip
        days={props.days}
        slot={slot}
        open={props.open}
        windowIds={windowIds}
        nothingOpen={props.nothingOpen}
        onDay={(date) => {
          props.onPick({ date, window: slot.window, start: null });
        }}
      />

      <DayWindows
        windows={props.windows}
        slot={slot}
        open={props.open}
        onWindow={(window) => {
          props.onPick({ date: slot.date, window, start: null });
        }}
        onStart={(window, start) => {
          props.onPick({ date: slot.date, window, start });
        }}
      />
    </>
  );
}

/** The address's part of the form, and who is booking. On /book, its fourth step. */
function AddressPart(
  props: ConsultationProps & {
    form: ReturnType<typeof useTurnstileForm>;
    address: AddressFields;
    addressBad: ReturnType<typeof partsToMark>;
    onAddress: (address: AddressFields) => void;
    extent: LossExtent | null;
    onExtent: (extent: LossExtent | null) => void;
    /** The site's own page takes a discount code for the one visit (ADR 0108); null where it takes none. */
    discount: { code: string; refused: boolean; onCode: (code: string) => void } | null;
    remembered: ReturnType<typeof rememberedInvite>;
    onWithout: () => void;
    /** The WhatsApp code the number is waiting for; null when none is. */
    numberCode: ReturnType<typeof useNumberCode> | null;
    onCodeAgain: (event: Event) => void;
  },
) {
  const { form, numberCode, discount } = props;
  const { consultation } = referral;
  return (
    <>
      {props.stage === "address" && <StepLine at={4} name={booking.steps.address} focus />}
      <AddressFieldset
        address={props.address}
        missing={props.addressBad}
        pincode={props.answer.pincode}
        idPrefix="invite-consultation"
        onChange={props.onAddress}
      />

      {!props.invited && <ExtentFieldset extent={props.extent} onChange={props.onExtent} />}

      {discount !== null && <DiscountCode code={discount.code} refused={discount.refused} onCode={discount.onCode} />}

      {props.person === null && (
        <PersonFieldset
          fields={form.fields}
          bad={form.personBad}
          idPrefix="invite-consultation"
          consentLabel={consultation.consent}
          consentNote=""
          onChange={form.setFields}
        />
      )}

      {props.remembered !== null && (
        <RememberedInvite
          line={referral.remembered.consultation(props.reward)}
          without={referral.remembered.bookWithout}
          onWithout={props.onWithout}
        />
      )}

      {numberCode !== null && (
        <NumberCodeField
          idPrefix="invite-number"
          mobile={form.fields.mobile}
          code={numberCode.code}
          failure={numberCode.failure}
          onInk={false}
          classes={CODE_FIELD}
          onInput={numberCode.setCode}
          onAgain={props.onCodeAgain}
        />
      )}
    </>
  );
}

/**
 * The pincode is served, so the page books a free consultation. The form also takes the address the
 * consultation is at, so nothing is booked without one (ADR 0081). It may book the
 * consultation and fit in one visit instead: three hours, in the morning or the
 * afternoon, paid for once the client is fitted (ADR 0105), and, on the site's own page, with a discount code that
 * comes off the hair system's price when they pay. That one is booked only once the WhatsApp code sent to
 * the number has been entered.
 */
export function Consultation(props: ConsultationProps) {
  const { person, stage } = props;
  const form = useTurnstileForm(
    props.turnstileSiteKey,
    person === null ? MARKED_WITH_PERSON : MARKED_HERE,
    person === null ? undefined : { ...person, consent: true },
  );
  const numberCode = useNumberCode();
  const { plan } = props;
  const [picked, setPicked] = useState<Slot>(() => ({ date: indiaTomorrow(), window: "morning", start: null }));
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
  const nothingOpen = !anyOpen(open.days, windowIds);
  // The site's own page takes a discount code for the one visit; an invite's page is the invite's offer.
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
    if (stage === "visit") {
      event.preventDefault();
      form.clearFailure();
      props.onNext();
      return;
    }
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
      ...(slot.start === null ? {} : { starts_at: slot.start }),
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
        if (!answer.ok && outOfDate(answer.code)) {
          void open.refresh();
          if (stage === "address") props.onBackToVisit();
        }
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
      {stage !== "address" && (
        <VisitPart
          {...props}
          days={days}
          slot={slot}
          open={open.days}
          windows={windows}
          nothingOpen={nothingOpen}
          onPick={setPicked}
        />
      )}

      {stage !== "visit" && (
        <AddressPart
          {...props}
          form={form}
          address={address}
          addressBad={addressBad}
          onAddress={setAddress}
          extent={extent}
          onExtent={setExtent}
          discount={takesCode ? { code, refused: codeRefused, onCode: setCode } : null}
          remembered={remembered}
          onWithout={bookWithoutInvite}
          numberCode={codeWaiting ? numberCode : null}
          onCodeAgain={askForCode}
        />
      )}

      <div ref={form.box} class={styles.turnstile} />
      {/* With nothing open in the fortnight, there is no visit to go on from: WhatsApp is offered instead. */}
      {!(stage === "visit" && nothingOpen) && (
        <Send
          failure={form.failure}
          marked={marked}
          sending={form.sending || numberCode.checking}
          label={stage === "visit" ? booking.next : submitLabel(plan, codeWaiting)}
          sendingLabel={numberCode.checking ? numberCodeWords.checking : consultation.sending}
        />
      )}
      {props.credits && <p class={styles.told}>{consultation.told(props.name, props.reward)}</p>}
    </form>
  );
}
