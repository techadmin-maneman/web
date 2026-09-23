// The referral landing at /r/:code (design/phase2/Referral and Waitlist, boards
// C1 to C5). One island holds the whole page, because the pincode decides what
// the page is: a consultation form where we come, a waitlist where we do not.
//
// The invite arrives in the page itself: the mm-site Worker writes it onto
// #invite, so the referrer's name is there before any JavaScript runs and the
// preview WhatsApp fetches is the referrer's own card (site/src/worker.ts).
// Where it is missing — local dev, or a page served straight from the assets —
// the island fetches it, and an unknown code still books.
//
// Outside production, ?state=<arrival|served|unserved|booked|listed> opens a
// state directly, for the fidelity screenshots and the browser tests.

import { useEffect, useRef, useState } from "preact/hooks";
import { ICONS } from "@maneman/brand/icons";
import type { LossExtent } from "../../../src/config/booking.ts";
import { referral } from "../content/referral.ts";
import { booking, stageOptions } from "../content/site.ts";
import {
  bookConsultation,
  bookPublicConsultation,
  checkPincode,
  fetchInvite,
  joinPublicWaitlist,
  joinWaitlist,
  type ErrorCode,
  type Invite as InviteAnswer,
  type PincodeAnswer,
  type ReferralConsultation,
} from "../lib/api.ts";
import { bookedHeadline, dayStrip, indiaTomorrow } from "../lib/dates.ts";
import { formatMobile, isCompleteMobile, mobileDigits } from "../lib/phone.ts";
import { fill } from "../lib/text.ts";
import { turnstileWidget } from "../lib/turnstile.ts";
import { readAttribution } from "../lib/visit.ts";
import styles from "./Invite.module.css";
import { Icon, StageDrawing } from "./Drawings.tsx";

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
const PREVIEW_STATES = ["arrival", "served", "unserved", "booked", "listed"] as const;
type PreviewState = (typeof PREVIEW_STATES)[number];

/** How far ahead the date strip reaches, from tomorrow: src/config/scheduling.ts, BOOKING_DAYS. */
const DAYS = 14;

const UNKNOWN_INVITE: InviteAnswer = {
  state: "unknown",
  referrer_first_name: null,
  card: { state: "house", version: 1 },
};

/** The stand-ins ?state= uses, with the design's own pincodes. */
const SAMPLE = {
  served: { pincode: "122018", served: true, area: "Sector 65", city: "Gurgaon" },
  unserved: { pincode: "400050", served: false, area: "Bandra", city: "Mumbai" },
} satisfies Record<string, PincodeAnswer>;

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
const HOUSE_CARD = "/images/invite-house.jpg";

function cardImage(invite: InviteAnswer, code: string): string {
  if (invite.card.state !== "personal" || code === "") return HOUSE_CARD;
  return `/api/og/${code}.jpg?v=${String(invite.card.version)}`;
}

/** The invite the Worker wrote into the page, if it did. */
function inviteInPage(): InviteAnswer | null {
  const written = document.getElementById("invite")?.dataset.invite;
  if (written === undefined || written === "") return null;
  try {
    return JSON.parse(written) as InviteAnswer;
  } catch {
    return null;
  }
}

function refusal(code: ErrorCode | "network"): string {
  const { errors } = referral;
  if (code === "rate_limited") return errors.rateLimited;
  if (code === "turnstile_failed") return errors.turnstile;
  if (code === "taken") return errors.taken;
  if (code === "ops_assisted") return errors.opsAssisted;
  if (code === "not_bookable") return errors.notBookable;
  return errors.other;
}

export default function Invite(props: Props) {
  const [invite, setInvite] = useState<InviteAnswer>(UNKNOWN_INVITE);
  const [state, setState] = useState<State>("arrival");
  const [pincode, setPincode] = useState("");
  const [answer, setAnswer] = useState<PincodeAnswer | null>(null);
  const [pincodeError, setPincodeError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [booked, setBooked] = useState<ReferralConsultation | null>(null);
  const [listed, setListed] = useState<{ area: string | null; credits: boolean } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLDivElement>(null);

  const invited = (props.mode ?? "invited") === "invited";
  const name = invited ? invite.referrer_first_name : null;

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
      if (found.ok) setInvite(found.body);
    });
  }, [invited]);

  useEffect(() => {
    if (!props.allowStateSwitch) return;
    const wanted = new URLSearchParams(location.search).get("state");
    const found = PREVIEW_STATES.find((candidate): candidate is PreviewState => candidate === wanted);
    if (found === undefined || found === "arrival") return;
    if (found === "served") setAnswer(SAMPLE.served);
    if (found === "unserved") setAnswer(SAMPLE.unserved);
    if (found === "booked") {
      setBooked({ state: "booked", date: indiaTomorrow(), window: "morning", area: SAMPLE.served.area, credits: true });
      setState("booked");
    }
    if (found === "listed") {
      setListed({ area: SAMPLE.unserved.area, credits: true });
      setState("listed");
    }
  }, [props.allowStateSwitch]);

  useEffect(() => {
    if (state !== "arrival") {
      globalThis.scrollTo(0, 0);
      heading.current?.focus();
    }
  }, [state]);

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
    setAnswer(found.body);
    // The form that replaces this answer is what the visitor came for.
    globalThis.requestAnimationFrame(() => {
      form.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  const showArrival = state === "arrival";
  return (
    <>
      {showArrival && (
        <>
          <section class={styles.arrival}>
            <div class={styles.inner}>
              {invited && (
                <>
                  <div class={`caps ${styles.from}`}>
                    {name === null ? referral.arrival.unnamed : fill(referral.arrival.invited, { name })}
                  </div>
                  <img
                    class={styles.inviteCard}
                    src={cardImage(invite, codeInPath())}
                    width={CARD.width}
                    height={CARD.height}
                    alt=""
                    onError={(event) => {
                      event.currentTarget.src = HOUSE_CARD;
                    }}
                  />
                </>
              )}
              <h1 ref={heading} tabIndex={-1} class={styles.title}>
                {invited ? referral.arrival.title : booking.title}
              </h1>
              {!invited && <p class={styles.offer}>{booking.intro}</p>}
              {invited &&
                (invite.state === "valid" ? (
                  <p class={styles.offer}>{referral.arrival.offer}</p>
                ) : (
                  <p class={styles.offer}>
                    <span class={styles.unknownTitle}>{referral.arrival.unknown.title}</span>
                    <span class={styles.unknownBody}>{referral.arrival.unknown.body}</span>
                  </p>
                ))}
            </div>
          </section>

          <section class={styles.prices}>
            <div class={styles.inner}>
              <dl class={styles.priceRows}>
                {referral.prices.rows.map((row) => (
                  <div key={row.what} class={styles.priceRow}>
                    <dt>
                      <span class={styles.priceWhat}>{row.what}</span>
                      <span class={styles.priceNote}>{row.note}</span>
                    </dt>
                    <dd>
                      <span class={styles.priceAmount}>{row.amount}</span>
                      <span class={styles.priceNote}>{row.incl}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section class={styles.steps}>
            <div class={styles.inner}>
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
          </section>

          {/* The navy block, which the answer replaces in place: no new page (board C5). */}
          <section class={`${styles.pincode} on-ink`}>
            <div class={styles.inner}>
              {answer !== null ? (
                <>
                  <div class={styles.answer}>
                    {answer.served && <Icon path={ICONS.tick} size={20} stroke={1.7} />}
                    <span>
                      {answer.served
                        ? fill(referral.consultation.served, { area: answer.area ?? "" })
                        : answer.area === null
                          ? referral.waitlist.titleUnknown
                          : fill(referral.waitlist.title, { area: answer.area })}
                    </span>
                  </div>
                  {!answer.served && <p class={styles.answerBody}>{referral.waitlist.body}</p>}
                </>
              ) : (
                <>
                  <h2 class={`section-title ${styles.pincodeTitle}`}>{referral.pincode.title}</h2>
                  <form class={styles.pincodeForm} onSubmit={(event) => void check(event)} noValidate>
                    <div class={styles.pincodeField}>
                      <label class={styles.label} for="invite-pincode">
                        {referral.pincode.label}
                      </label>
                      <input
                        id="invite-pincode"
                        class={`${styles.input} ${pincodeError === null ? "" : styles.bad}`}
                        value={pincode}
                        placeholder={referral.pincode.placeholder}
                        inputMode="numeric"
                        autocomplete="postal-code"
                        aria-invalid={pincodeError !== null}
                        aria-describedby={pincodeError === null ? undefined : "invite-pincode-error"}
                        onInput={(event) => {
                          setPincode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6));
                        }}
                      />
                    </div>
                    <button type="submit" class="btn btn--lg btn--paper" aria-disabled={checking}>
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
            </div>
          </section>

          <div ref={form}>
            {answer?.served === true && (
              <Consultation
                answer={answer}
                name={name}
                invited={invited}
                turnstileSiteKey={props.turnstileSiteKey}
                onBooked={(result) => {
                  setBooked(result);
                  setState("booked");
                }}
              />
            )}
            {answer?.served === false && (
              <Waitlist
                answer={answer}
                name={name}
                invited={invited}
                turnstileSiteKey={props.turnstileSiteKey}
                onListed={(result) => {
                  setListed(result);
                  setState("listed");
                }}
              />
            )}
          </div>
        </>
      )}

      {state === "booked" && booked !== null && <Booked result={booked} heading={heading} />}
      {state === "listed" && listed !== null && <Listed result={listed} name={name} heading={heading} />}
    </>
  );
}

/**
 * Where the hair loss is, as the site's own form has always asked (v2's booking board).
 * An invited friend is never asked: their invite carries no such question.
 */
function ExtentFieldset(props: { extent: LossExtent; onChange: (extent: LossExtent) => void }) {
  return (
    <fieldset class={styles.group}>
      <legend class={styles.label}>{booking.extent}</legend>
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
  turnstileSiteKey: string;
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

      <label class={styles.consent}>
        <input
          type="checkbox"
          class="visually-hidden"
          checked={fields.consent}
          aria-invalid={consentBad}
          aria-describedby={consentBad ? `${idPrefix}-consent-error` : undefined}
          onChange={(event) => {
            props.onChange({ ...fields, consent: event.currentTarget.checked });
          }}
        />
        <span class={`${styles.box} ${consentBad ? styles.bad : ""}`} aria-hidden="true">
          {fields.consent && <Icon path={ICONS.tick} size={13} stroke={1.7} />}
        </span>
        <span class={styles.consentText}>
          {props.consentLabel}
          <span class={styles.consentNote}>{props.consentNote}</span>
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

/** Board C2: the pincode is served, so the page books a free consultation. */
function Consultation(props: FormProps & { onBooked: (result: ReferralConsultation) => void }) {
  const [fields, setFields] = useState<PersonFields>({ name: "", mobile: "", consent: false });
  const [date, setDate] = useState(indiaTomorrow());
  const [window, setWindow] = useState<BookingWindow>("morning");
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [extent, setExtent] = useState<LossExtent>("crown");
  const turnstile = useTurnstile(props.turnstileSiteKey);
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
    const shared = {
      name: fields.name.trim(),
      mobile: mobileDigits(fields.mobile),
      pincode: props.answer.pincode,
      date,
      window,
      consent: true as const,
      turnstile_token: token,
    };
    // The site's own page carries where this visit came from; the invite carries the invite.
    const attribution = readAttribution();
    const result = props.invited
      ? await bookConsultation(codeInPath(), shared, crypto.randomUUID())
      : await bookPublicConsultation(
          { ...shared, loss_extent: extent, ...(attribution === undefined ? {} : { attribution }) },
          crypto.randomUUID(),
        );
    void turnstile.widget.current?.renew();
    setSending(false);
    if (!result.ok) {
      if (result.code === "invalid_request") setTouched(true);
      setFailure(refusal(result.code));
      return;
    }
    props.onBooked({ credits: false, ...result.body });
  }

  const { consultation } = referral;
  return (
    <section class={styles.formSection}>
      <div class={styles.inner}>
        <h2 class={`section-title ${styles.formTitle}`}>{consultation.title}</h2>
        <p class={styles.formBody}>{consultation.body}</p>

        <form class={styles.card} onSubmit={(event) => void submit(event)} noValidate>
          <fieldset class={styles.group}>
            <legend class={styles.label}>{consultation.date}</legend>
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
            <legend class={styles.label}>{consultation.window}</legend>
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

          <div class={styles.fields}>
            <PersonFieldset
              fields={fields}
              touched={touched}
              idPrefix="invite-consultation"
              consentLabel={consultation.consent}
              consentNote=""
              onChange={setFields}
            />
          </div>

          <div ref={turnstile.box} class={styles.turnstile} />
          <div aria-live="polite">{failure !== null && <div class={styles.failure}>{failure}</div>}</div>

          <button type="submit" class="btn btn--lg btn--ink" aria-disabled={sending}>
            {sending && <Icon path={ICONS.sending} size={15} stroke={1.7} />}
            {sending ? consultation.sending : consultation.submit}
          </button>
          <p class={styles.told}>
            {props.name === null ? consultation.toldUnnamed : fill(consultation.told, { name: props.name })}
          </p>
        </form>
      </div>
    </section>
  );
}

/** Board C3: we do not come there yet, so the page takes a number instead. */
function Waitlist(props: FormProps & { onListed: (result: { area: string | null; credits: boolean }) => void }) {
  const [fields, setFields] = useState<PersonFields>({ name: "", mobile: "", consent: false });
  const [alert, setAlert] = useState(false);
  const [extent, setExtent] = useState<LossExtent>("crown");
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const turnstile = useTurnstile(props.turnstileSiteKey);

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
    const shared = {
      name: fields.name.trim(),
      mobile: mobileDigits(fields.mobile),
      pincode: props.answer.pincode,
      contact_consent: true as const,
      launch_alert: alert,
      turnstile_token: token,
    };
    const attribution = readAttribution();
    const result = props.invited
      ? await joinWaitlist(codeInPath(), shared, crypto.randomUUID())
      : await joinPublicWaitlist(
          { ...shared, loss_extent: extent, ...(attribution === undefined ? {} : { attribution }) },
          crypto.randomUUID(),
        );
    void turnstile.widget.current?.renew();
    setSending(false);
    if (!result.ok) {
      if (result.code === "invalid_request") setTouched(true);
      setFailure(refusal(result.code));
      return;
    }
    props.onListed({ credits: false, ...result.body });
  }

  const { waitlist } = referral;
  const area = props.answer.area;
  return (
    <section class={styles.formSection}>
      <div class={styles.inner}>
        <form class={styles.card} onSubmit={(event) => void submit(event)} noValidate>
          <div class={`caps ${styles.served}`}>{waitlist.leave}</div>
          <p class={styles.forPincode}>
            {fill(waitlist.forPincode, {
              pincode: props.answer.pincode,
              area: area === null ? "" : `, ${area}`,
            })}
          </p>

          {!props.invited && <ExtentFieldset extent={extent} onChange={setExtent} />}

          <div class={styles.fields}>
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
                <span class={styles.consentNote}>{waitlist.optional}</span>
              </span>
            </label>
          </div>

          <div ref={turnstile.box} class={styles.turnstile} />
          <div aria-live="polite">{failure !== null && <div class={styles.failure}>{failure}</div>}</div>

          <button type="submit" class="btn btn--lg btn--ink" aria-disabled={sending}>
            {sending && <Icon path={ICONS.sending} size={15} stroke={1.7} />}
            {sending ? waitlist.sending : waitlist.submit}
          </button>
          <p class={styles.told}>
            {props.name === null ? waitlist.holdsUnnamed : fill(waitlist.holds, { name: props.name })}
          </p>
        </form>
      </div>
    </section>
  );
}

/** Board C4: the consultation is booked. */
function Booked(props: { result: ReferralConsultation; heading: { current: HTMLHeadingElement | null } }) {
  const { result } = props;
  const hours = referral.consultation.windows.find((option) => option.id === result.window)?.hours ?? "";
  return (
    <section class={styles.done}>
      <div class={styles.inner}>
        <span class={styles.tick}>
          <Icon path={ICONS.tick} size={30} stroke={1.7} />
        </span>
        <div class={`caps ${styles.doneLabel}`}>{referral.booked.label}</div>
        <h1 ref={props.heading} tabIndex={-1} class={styles.doneTitle}>
          {bookedHeadline(result.date, hours)}
        </h1>
        <p class={styles.doneBody}>{referral.booked.body}</p>
        <p class={styles.doneWhere}>{`${result.area} · ${referral.booked.free}`}</p>
        {result.credits && <p class={styles.doneNote}>{referral.booked.credits}</p>}
        <a class="btn btn--lg btn--line-on-paper" href="/">
          {referral.booked.back}
        </a>
      </div>
    </section>
  );
}

/** Board C4: the number is on the list for a pincode we do not serve yet. */
function Listed(props: {
  result: { area: string | null; credits: boolean };
  name: string | null;
  heading: { current: HTMLHeadingElement | null };
}) {
  const { listed } = referral;
  const area = props.result.area;
  return (
    <section class={styles.done}>
      <div class={styles.inner}>
        <div class={`caps ${styles.doneLabel}`}>{listed.label}</div>
        <h1 ref={props.heading} tabIndex={-1} class={styles.doneTitle}>
          {area === null ? listed.titleUnknown : fill(listed.title, { area })}
        </h1>
        <p class={styles.doneBody}>{listed.body}</p>
        {props.result.credits && (
          <p class={styles.doneNote}>
            {props.name === null ? listed.credits : fill(listed.creditsFrom, { name: props.name })}
          </p>
        )}
        <div class={styles.doneActions}>
          <a class="btn btn--lg btn--ink" href="/try">
            {listed.tryOn}
          </a>
          <a class="btn btn--lg btn--line-on-paper" href="/">
            {listed.back}
          </a>
        </div>
      </div>
    </section>
  );
}
