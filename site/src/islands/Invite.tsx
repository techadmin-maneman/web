// The referral landing at /r/:code (design/phase2/Referral and Waitlist, boards
// C1 to C5), and the site's own /book, which is the same page without the
// invite. One island holds the whole page, because the pincode decides what
// the page is: a consultation form where we come, a waitlist where we do not.
//
// The invite arrives in the page itself: the mm-site Worker writes it onto
// #invite, so the referrer's name is there before any JavaScript runs and the
// preview WhatsApp fetches is the referrer's own card (site/src/worker.ts).
// Where it is missing — local dev, a page served straight from the assets, or
// mm-api not answering the Worker — the island fetches it, and any code books.
//
// Outside production, ?state=<arrival|served|unserved|booked|requested|expired|listed>
// opens a state directly, for the fidelity screenshots and the browser tests.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ICONS } from "@maneman/brand/icons";
import type { LossExtent } from "../../../src/config/booking.ts";
import { referral } from "../content/referral.ts";
import { booking, stageOptions } from "../content/site.ts";
import { track } from "../lib/analytics.ts";
import {
  bookConsultation,
  bookPublicConsultation,
  checkPincode,
  fetchInvite,
  joinPublicWaitlist,
  joinWaitlist,
  type AlreadyBooked,
  type ErrorCode,
  type Invite as InviteAnswer,
  type PincodeAnswer,
  type ReferralConsultation,
} from "../lib/api.ts";
import { bookedHeadline, dayStrip, indiaTomorrow } from "../lib/dates.ts";
import { keyPerRequest } from "../lib/idempotency.ts";
import { cardPath, HOUSE_CARD, isInvite } from "../lib/invite.ts";
import { formatMobile, isCompleteMobile, mobileDigits } from "../lib/phone.ts";
import { fill } from "../lib/text.ts";
import { turnstileWidget } from "../lib/turnstile.ts";
import { readAttribution } from "../lib/visit.ts";
import { Icon, StageDrawing } from "./Drawings.tsx";
import styles from "./Invite.module.css";
import { Booked, Listed, placeOf, windowHours, type Booking, type Listing } from "./InviteDone.tsx";

interface Props {
  turnstileSiteKey: string;
  /** Outside production only: ?state= opens a state directly. */
  allowStateSwitch: boolean;
  /**
   * "invited" is /r/:code, where a friend arrives with someone's invite. "public"
   * is the site's own /book, which shows no card and no invite, asks where the
   * hair loss is as Phase 1's form did, and books without one
   * (docs/decisions/0051-booking-from-the-site.md).
   */
  mode?: "invited" | "public";
}

type BookingWindow = ReferralConsultation["window"];
type State = "arrival" | "booked" | "listed";
const PREVIEW_STATES = ["arrival", "served", "unserved", "booked", "requested", "expired", "listed"] as const;
type PreviewState = (typeof PREVIEW_STATES)[number];

/** How far ahead the date strip reaches, from tomorrow: src/config/scheduling.ts, BOOKING_DAYS. */
const DAYS = 14;

/** The stand-ins ?state= uses, with the design's own pincodes and number. */
const SAMPLE = {
  served: { pincode: "122018", served: true, area: "Sector 65", city: "Gurgaon" },
  unserved: { pincode: "400050", served: false, area: "Bandra", city: "Mumbai" },
  mobile: "98100 04417",
} satisfies Record<string, PincodeAnswer | string>;

/**
 * The code in the address: /r/ABC123. Empty where the page is opened without one, and while
 * the page is built: Astro renders the island once on the server, where there is no address.
 */
function codeInPath(): string {
  if (typeof location === "undefined") return "";
  return /^\/r\/([A-Za-z0-9]{4,12})\/?$/.exec(location.pathname)?.[1]?.toUpperCase() ?? "";
}

/** The card the page shows: the referrer's own while it is live, else our house one. */
export const CARD = { width: 1200, height: 630 };

/** The invite the Worker wrote into the page, if it did and it reads as one. */
function inviteInPage(): InviteAnswer | null {
  const written = document.getElementById("invite")?.dataset.invite;
  if (written === undefined || written === "") return null;
  try {
    const parsed: unknown = JSON.parse(written);
    return isInvite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function refusal(code: ErrorCode | "network", booked: AlreadyBooked | undefined): string {
  const { errors } = referral;
  if (booked !== undefined) {
    return fill(errors.alreadyBooked, { when: bookedHeadline(booked.date, windowHours(booked.window)) });
  }
  if (code === "rate_limited") return errors.rateLimited;
  if (code === "turnstile_failed") return errors.turnstile;
  if (code === "taken") return errors.taken;
  if (code === "not_bookable") return errors.notBookable;
  return errors.other;
}

/** The answer a ?state= preview opens with. */
function sampleBooking(state: "booked" | "requested" | "expired"): Booking {
  const result: ReferralConsultation = {
    state: state === "requested" ? "requested" : "booked",
    date: indiaTomorrow(),
    window: "morning",
    area: SAMPLE.served.area,
    credits: state !== "expired",
    invite: state === "expired" ? "expired" : "valid",
  };
  return { result, mobile: SAMPLE.mobile, place: placeOf(SAMPLE.served) };
}

export default function Invite(props: Props) {
  // Null until the invite is known: the page then says only what is true of every invite.
  const [invite, setInvite] = useState<InviteAnswer | null>(null);
  const [state, setState] = useState<State>("arrival");
  const [pincode, setPincode] = useState("");
  const [answer, setAnswer] = useState<PincodeAnswer | null>(null);
  const [pincodeError, setPincodeError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [booked, setBooked] = useState<Booking | null>(null);
  const [listed, setListed] = useState<Listing | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLElement>(null);
  const answerHeading = useRef<HTMLHeadingElement>(null);
  const pincodeField = useRef<HTMLInputElement>(null);
  // Where focus goes once the pincode's answer has drawn, or gone again.
  const focusNext = useRef<"answer" | "field" | null>(null);

  const invited = (props.mode ?? "invited") === "invited";
  const name = invited ? (invite?.referrer_first_name ?? null) : null;
  // Only a valid invite carries the 3 visits; the API books any other without them.
  const credits = invited && invite?.state === "valid";

  // The invite: from the page where the Worker wrote it, otherwise from the API.
  useEffect(() => {
    if (!invited) return;
    const written = inviteInPage();
    if (written !== null) {
      setInvite(written);
      return;
    }
    const code = codeInPath();
    if (code === "") return;
    void fetchInvite(code).then((found) => {
      if (found.ok && isInvite(found.body)) setInvite(found.body);
    });
  }, [invited]);

  useEffect(() => {
    if (!props.allowStateSwitch) return;
    const wanted = new URLSearchParams(location.search).get("state");
    const found = PREVIEW_STATES.find((candidate): candidate is PreviewState => candidate === wanted);
    if (found === undefined || found === "arrival") return;
    if (found === "served") setAnswer(SAMPLE.served);
    if (found === "unserved") setAnswer(SAMPLE.unserved);
    if (found === "booked" || found === "requested" || found === "expired") {
      setBooked(sampleBooking(found));
      setState("booked");
    }
    if (found === "listed") {
      setListed({ area: SAMPLE.unserved.area, credits: true, invite: "valid" });
      setState("listed");
    }
  }, [props.allowStateSwitch]);

  useEffect(() => {
    if (state !== "arrival") {
      globalThis.scrollTo(0, 0);
      heading.current?.focus();
    }
  }, [state]);

  // The answer is read out by moving focus to it, and the page brings it, with the form beneath, into view.
  useEffect(() => {
    if (focusNext.current === "answer") {
      answerHeading.current?.focus({ preventScroll: true });
      // The page's own scroll-behavior is smooth, and instant for a visitor who asks for reduced motion.
      panel.current?.scrollIntoView({ block: "start" });
    }
    if (focusNext.current === "field") pincodeField.current?.focus();
    focusNext.current = null;
  }, [answer]);

  async function check(event: Event) {
    event.preventDefault();
    if (!/^[1-8]\d{5}$/.test(pincode)) {
      setPincodeError(referral.pincode.invalid);
      setAnswer(null);
      return;
    }
    setChecking(true);
    setPincodeError(null);
    const found = await checkPincode(pincode);
    setChecking(false);
    if (!found.ok) {
      setPincodeError(referral.pincode.failed);
      return;
    }
    focusNext.current = "answer";
    setAnswer(found.body);
  }

  function changePincode() {
    focusNext.current = "field";
    setAnswer(null);
  }

  const formProps = {
    name,
    invited,
    credits,
    turnstileSiteKey: props.turnstileSiteKey,
    onChangePincode: changePincode,
  };

  if (state === "booked" && booked !== null) return <Booked booking={booked} heading={heading} />;
  if (state === "listed" && listed !== null) return <Listed listing={listed} name={name} heading={heading} />;
  return (
    <section class={styles.arrival}>
      <div class={`${styles.inner} ${styles.grid}`}>
        <div class={styles.lead}>
          {invited && (
            <div class={`caps ${styles.from}`}>
              {name === null ? referral.arrival.unnamed : fill(referral.arrival.invited, { name })}
            </div>
          )}
          <h1 ref={heading} tabIndex={-1} class={styles.title}>
            {invited ? referral.arrival.title : booking.title}
          </h1>
          <div class={styles.offer}>
            {!invited && <p>{booking.intro}</p>}
            {credits && <p>{referral.arrival.offer}</p>}
            {invited && invite !== null && !credits && (
              <p>
                <span class={styles.unknownTitle}>{referral.arrival.unknown.title}</span>
                <span class={styles.unknownBody}>{referral.arrival.unknown.body}</span>
              </p>
            )}
          </div>
          <Prices />

          {/* The navy block, which the answer replaces in place: no new page (board C5). */}
          <section ref={panel} class={`${styles.panel} ${answer === null ? "" : styles.answered} on-ink`}>
            {answer !== null ? (
              <PincodeAnswerBlock answer={answer} heading={answerHeading} />
            ) : (
              <>
                <h2 class={styles.panelTitle}>{referral.pincode.title}</h2>
                <form class={styles.pincodeForm} onSubmit={(event) => void check(event)} noValidate>
                  <div class={styles.pincodeField}>
                    <label class={styles.label} for="invite-pincode">
                      {referral.pincode.label}
                    </label>
                    <input
                      ref={pincodeField}
                      id="invite-pincode"
                      class={`${styles.input} ${pincodeError === null ? "" : styles.bad}`}
                      value={pincode}
                      placeholder={referral.pincode.placeholder}
                      inputMode="numeric"
                      autocomplete="postal-code"
                      aria-required="true"
                      aria-invalid={pincodeError !== null}
                      aria-describedby={pincodeError === null ? undefined : "invite-pincode-error"}
                      onInput={(event) => {
                        setPincode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6));
                      }}
                    />
                  </div>
                  <button type="submit" class={`btn btn--lg btn--paper ${styles.check}`} aria-disabled={checking}>
                    {checking ? referral.pincode.checking : referral.pincode.check}
                  </button>
                </form>
                <div aria-live="polite">
                  {pincodeError !== null && (
                    <div id="invite-pincode-error" class={styles.error}>
                      {pincodeError}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>

          {answer?.served === true && (
            <Consultation
              {...formProps}
              answer={answer}
              onBooked={(result) => {
                setBooked(result);
                setState("booked");
              }}
            />
          )}
          {answer?.served === false && (
            <Waitlist
              {...formProps}
              answer={answer}
              onListed={(result) => {
                setListed(result);
                setState("listed");
              }}
            />
          )}
        </div>

        <div class={styles.aside}>
          {invited && (
            <img
              class={styles.inviteCard}
              src={invite === null ? HOUSE_CARD : cardPath(invite, codeInPath())}
              width={CARD.width}
              height={CARD.height}
              alt=""
              onError={(event) => {
                event.currentTarget.src = HOUSE_CARD;
              }}
            />
          )}
          <HowItWorks />
        </div>
      </div>
    </section>
  );
}

function Prices() {
  return (
    <dl class={styles.prices}>
      {referral.prices.rows.map((row) => (
        <div key={row.what} class={styles.priceRow}>
          <dt>
            <span class={styles.priceWhat}>{row.what}</span>
            <span class={styles.priceNote}>{row.note}</span>
          </dt>
          <dd>
            <span class={styles.priceAmount}>{row.amount}</span>
            <span class={styles.priceIncl}>{row.incl}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function HowItWorks() {
  return (
    <div class={styles.steps}>
      <h2 class={`caps ${styles.stepsTitle}`}>{referral.howItWorks.title}</h2>
      <ol class={styles.stepList}>
        {referral.howItWorks.steps.map((step) => (
          <li key={step.n} class={styles.step}>
            <span class={styles.stepNumber}>{step.n}</span>
            <div>
              <h3 class={styles.stepTitle}>{step.title}</h3>
              <p class={styles.stepBody}>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Boards C2 and C3: what the pincode answered, in the navy block's place. */
function PincodeAnswerBlock(props: { answer: PincodeAnswer; heading: { current: HTMLHeadingElement | null } }) {
  const { answer } = props;
  if (answer.served) {
    return (
      <h2 ref={props.heading} tabIndex={-1} class={styles.answer}>
        <Icon path={ICONS.tick} size={21} stroke={1.7} />
        {fill(referral.consultation.served, { area: answer.area ?? "" })}
      </h2>
    );
  }
  return (
    <>
      <h2 ref={props.heading} tabIndex={-1} class={styles.answer}>
        {answer.area === null ? referral.waitlist.titleUnknown : fill(referral.waitlist.title, { area: answer.area })}
      </h2>
      <p class={styles.answerBody}>{referral.waitlist.body}</p>
    </>
  );
}

/** "For 122018 · Change": the pincode the form is for, and the way back to the field (not drawn). */
function ForPincode(props: { text: string; onChange: () => void }) {
  return (
    <p class={styles.forPincode}>
      {props.text}
      {" · "}
      <button type="button" class={styles.change} aria-label={referral.pincode.changeLabel} onClick={props.onChange}>
        {referral.pincode.change}
      </button>
    </p>
  );
}

/**
 * Where the hair loss is, as the site's own form has always asked (v2's booking board).
 * An invited friend is never asked: their invite carries no such question.
 */
function ExtentFieldset(props: { extent: LossExtent; onChange: (extent: LossExtent) => void }) {
  return (
    <fieldset class={styles.group}>
      <legend class={`caps ${styles.legend}`}>{booking.extent}</legend>
      <div class={styles.extents}>
        {stageOptions.map((option) => (
          <label key={option.id} class={`${styles.extent} ${props.extent === option.id ? styles.extentOn : ""}`}>
            <input
              type="radio"
              name="extent"
              class="visually-hidden"
              checked={props.extent === option.id}
              onChange={() => {
                props.onChange(option.id);
              }}
            />
            <StageDrawing hair={option.hair} zone={option.zone} size="small" />
            <span class={styles.extentText}>{option.short}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** What both forms hold: the name, the number and the agreement. */
interface PersonFields {
  name: string;
  mobile: string;
  consent: boolean;
}

interface FormProps {
  answer: PincodeAnswer;
  name: string | null;
  /** The invited page carries someone's invite; the site's own does not. */
  invited: boolean;
  /** The invite is valid, so its 3 visits apply and its referrer is told. */
  credits: boolean;
  turnstileSiteKey: string;
  onChangePincode: () => void;
}

/**
 * The Turnstile widget for a form, made when that form appears: the box it renders into does
 * not exist until the pincode has decided which form the page shows.
 */
function useTurnstile(siteKey: string) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<ReturnType<typeof turnstileWidget> | null>(null);
  useEffect(() => {
    if (box.current !== null) widget.current = turnstileWidget(box.current, siteKey);
  }, [siteKey]);
  return { box, widget };
}

function PersonFieldset(props: {
  fields: PersonFields;
  touched: boolean;
  idPrefix: string;
  consentLabel: string;
  consentNote: string;
  onChange: (fields: PersonFields) => void;
}) {
  const { fields, touched, idPrefix } = props;
  const nameBad = touched && fields.name.trim() === "";
  const mobileBad = touched && !isCompleteMobile(fields.mobile);
  const consentBad = touched && !fields.consent;
  return (
    <>
      <div class={styles.fields}>
        <div>
          <label class={styles.label} for={`${idPrefix}-name`}>
            {referral.form.name}
          </label>
          <input
            id={`${idPrefix}-name`}
            class={`${styles.input} ${nameBad ? styles.bad : ""}`}
            value={fields.name}
            placeholder={referral.form.namePlaceholder}
            autocomplete="name"
            aria-required="true"
            aria-invalid={nameBad}
            aria-describedby={nameBad ? `${idPrefix}-name-error` : undefined}
            onInput={(event) => {
              props.onChange({ ...fields, name: event.currentTarget.value });
            }}
          />
          <div aria-live="polite">
            {nameBad && (
              <div id={`${idPrefix}-name-error`} class={styles.error}>
                {referral.form.nameError}
              </div>
            )}
          </div>
        </div>

        <div>
          <label class={styles.label} for={`${idPrefix}-mobile`}>
            {referral.form.mobile}
          </label>
          <div class={`${styles.mobile} ${mobileBad ? styles.bad : ""}`}>
            <span class={styles.prefix}>+91</span>
            <input
              id={`${idPrefix}-mobile`}
              class={styles.mobileInput}
              value={fields.mobile}
              placeholder={referral.form.mobilePlaceholder}
              inputMode="numeric"
              autocomplete="tel-national"
              aria-required="true"
              aria-invalid={mobileBad}
              aria-describedby={mobileBad ? `${idPrefix}-mobile-error` : undefined}
              onInput={(event) => {
                props.onChange({ ...fields, mobile: formatMobile(event.currentTarget.value) });
              }}
            />
          </div>
          <div aria-live="polite">
            {mobileBad && (
              <div id={`${idPrefix}-mobile-error`} class={styles.error}>
                {referral.form.mobileError}
              </div>
            )}
          </div>
        </div>
      </div>

      <label class={styles.consent}>
        <input
          type="checkbox"
          class="visually-hidden"
          checked={fields.consent}
          aria-required="true"
          aria-invalid={consentBad}
          aria-describedby={consentBad ? `${idPrefix}-consent-error` : undefined}
          onChange={(event) => {
            props.onChange({ ...fields, consent: event.currentTarget.checked });
          }}
        />
        <span class={`${styles.box} ${styles.boxRequired} ${consentBad ? styles.bad : ""}`} aria-hidden="true">
          {fields.consent && <Icon path={ICONS.tick} size={13} stroke={1.7} />}
        </span>
        <span class={styles.consentText}>
          {props.consentLabel}
          {props.consentNote !== "" && <span class={styles.consentNote}>{` ${props.consentNote}`}</span>}
        </span>
      </label>
      <div aria-live="polite">
        {consentBad && (
          <div id={`${idPrefix}-consent-error`} class={styles.error}>
            {referral.form.consentError}
          </div>
        )}
      </div>
    </>
  );
}

/** A form's refusal, and the button that sends it. */
function Send(props: { failure: string | null; sending: boolean; label: string; sendingLabel: string }) {
  return (
    <>
      <div aria-live="polite">{props.failure !== null && <div class={styles.failure}>{props.failure}</div>}</div>
      <button type="submit" class={`btn btn--lg btn--ink ${styles.submit}`} aria-disabled={props.sending}>
        {props.sending && <Icon path={ICONS.sending} size={15} stroke={1.7} />}
        {props.sending ? props.sendingLabel : props.label}
      </button>
    </>
  );
}

/** Board C2: the pincode is served, so the page books a free consultation. */
function Consultation(props: FormProps & { onBooked: (booking: Booking) => void }) {
  const [fields, setFields] = useState<PersonFields>({ name: "", mobile: "", consent: false });
  const [date, setDate] = useState(indiaTomorrow());
  const [window, setWindow] = useState<BookingWindow>("morning");
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [extent, setExtent] = useState<LossExtent>("crown");
  const turnstile = useTurnstile(props.turnstileSiteKey);
  const keyFor = useMemo(keyPerRequest, []);
  const days = dayStrip(indiaTomorrow(), DAYS);

  async function submit(event: Event) {
    event.preventDefault();
    if (sending) return;
    if (fields.name.trim() === "" || !isCompleteMobile(fields.mobile) || !fields.consent) {
      setTouched(true);
      return;
    }
    setSending(true);
    setFailure(null);
    const token = (await turnstile.widget.current?.token()) ?? null;
    if (token === null) {
      setFailure(referral.errors.turnstile);
      setSending(false);
      return;
    }
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
    const result = props.invited
      ? await bookConsultation(codeInPath(), { ...request, turnstile_token: token }, keyFor(request))
      : await bookPublicConsultation({ ...onBook, turnstile_token: token }, keyFor(onBook));
    void turnstile.widget.current?.renew();
    setSending(false);
    if (!result.ok) {
      if (result.code === "invalid_request") setTouched(true);
      setFailure(refusal(result.code, result.booked));
      return;
    }
    const booked = result.body;
    const page = props.invited ? "invite" : "book";
    const loss_extent = props.invited ? null : extent;
    track({ name: "lead_submitted", page, served: true, area: props.answer.area, window, loss_extent });
    track({ name: "booking_confirmed", page, area: booked.area, window: booked.window, state: booked.state });
    const place = placeOf(props.answer);
    props.onBooked({ result: { credits: false, invite: "unknown", ...booked }, mobile: fields.mobile, place });
  }

  const { consultation } = referral;
  return (
    <form class={styles.form} onSubmit={(event) => void submit(event)} noValidate>
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
        fields={fields}
        touched={touched}
        idPrefix="invite-consultation"
        consentLabel={consultation.consent}
        consentNote=""
        onChange={setFields}
      />

      <div ref={turnstile.box} class={styles.turnstile} />
      <Send failure={failure} sending={sending} label={consultation.submit} sendingLabel={consultation.sending} />
      {props.credits && (
        <p class={styles.told}>
          {props.name === null ? consultation.toldUnnamed : fill(consultation.told, { name: props.name })}
        </p>
      )}
    </form>
  );
}

/** Board C3: we do not come there yet, so the page takes a number instead. */
function Waitlist(props: FormProps & { onListed: (listing: Listing) => void }) {
  const [fields, setFields] = useState<PersonFields>({ name: "", mobile: "", consent: false });
  const [alert, setAlert] = useState(false);
  const [extent, setExtent] = useState<LossExtent>("crown");
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const turnstile = useTurnstile(props.turnstileSiteKey);
  const keyFor = useMemo(keyPerRequest, []);

  async function submit(event: Event) {
    event.preventDefault();
    if (sending) return;
    if (fields.name.trim() === "" || !isCompleteMobile(fields.mobile) || !fields.consent) {
      setTouched(true);
      return;
    }
    setSending(true);
    setFailure(null);
    const token = (await turnstile.widget.current?.token()) ?? null;
    if (token === null) {
      setFailure(referral.errors.turnstile);
      setSending(false);
      return;
    }
    const request = {
      name: fields.name.trim(),
      mobile: mobileDigits(fields.mobile),
      pincode: props.answer.pincode,
      contact_consent: true as const,
      launch_alert: alert,
    };
    const attribution = readAttribution();
    const onBook = { ...request, loss_extent: extent, ...(attribution === undefined ? {} : { attribution }) };
    const result = props.invited
      ? await joinWaitlist(codeInPath(), { ...request, turnstile_token: token }, keyFor(request))
      : await joinPublicWaitlist({ ...onBook, turnstile_token: token }, keyFor(onBook));
    void turnstile.widget.current?.renew();
    setSending(false);
    if (!result.ok) {
      if (result.code === "invalid_request") setTouched(true);
      setFailure(refusal(result.code, result.booked));
      return;
    }
    const page = props.invited ? "invite" : "book";
    const loss_extent = props.invited ? null : extent;
    track({ name: "lead_submitted", page, served: false, area: props.answer.area, window: null, loss_extent });
    track({ name: "waitlist_submitted", page, area: result.body.area });
    props.onListed({ credits: false, invite: "unknown", ...result.body });
  }

  const { waitlist } = referral;
  const area = props.answer.area;
  const forPincode = fill(waitlist.forPincode, {
    pincode: props.answer.pincode,
    area: area === null ? "" : `, ${area}`,
  });
  return (
    <form class={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      <div>
        <h2 class={styles.waitlistTitle}>{waitlist.leave}</h2>
        <ForPincode text={forPincode} onChange={props.onChangePincode} />
      </div>

      {!props.invited && <ExtentFieldset extent={extent} onChange={setExtent} />}

      <PersonFieldset
        fields={fields}
        touched={touched}
        idPrefix="invite-waitlist"
        consentLabel={waitlist.contactConsent}
        consentNote={waitlist.required}
        onChange={setFields}
      />

      <label class={styles.consent}>
        <input
          type="checkbox"
          class="visually-hidden"
          checked={alert}
          onChange={(event) => {
            setAlert(event.currentTarget.checked);
          }}
        />
        <span class={styles.box} aria-hidden="true">
          {alert && <Icon path={ICONS.tick} size={13} stroke={1.7} />}
        </span>
        <span class={styles.consentText}>
          {waitlist.launchAlert}
          <span class={styles.consentNote}>{` ${waitlist.optional}`}</span>
        </span>
      </label>

      <div ref={turnstile.box} class={styles.turnstile} />
      <Send failure={failure} sending={sending} label={waitlist.submit} sendingLabel={waitlist.sending} />
      {props.credits && (
        <p class={styles.told}>
          {props.name === null ? waitlist.holdsUnnamed : fill(waitlist.holds, { name: props.name })}
        </p>
      )}
    </form>
  );
}
