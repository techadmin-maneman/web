// The booking form and its booked and waitlist states. The cities come from
// GET /api/cities, in the API's order; a booking goes to POST /api/lead with a
// Turnstile token, a fresh idempotency key and the visit's attribution.
//
// The layout is v2's as it renders (ADR 0022): the intro, then the form card,
// inside the page's padding; the booked and waitlist screens after it.
//
// Outside production, ?state=<form|sending|booked|waitlist> opens a state
// directly, for the fidelity screenshots and the browser tests.

import { useEffect, useRef, useState } from "preact/hooks";
import type { LossExtent, VisitWindow } from "../../../src/config/booking.ts";
import { booking, stageOptions, visitWindows } from "../content/site.ts";
import { track } from "../lib/analytics.ts";
import { fetchCities, submitLead, type City, type ErrorCode, type LeadResponse } from "../lib/api.ts";
import { measurementCalendar } from "../lib/calendar.ts";
import { bookedHeadline } from "../lib/dates.ts";
import { ICONS } from "../lib/icons.ts";
import { formatMobile, isCompleteMobile } from "../lib/phone.ts";
import { fill } from "../lib/text.ts";
import { downloadFile } from "../lib/download.ts";
import { turnstileWidget } from "../lib/turnstile.ts";
import { readAttribution } from "../lib/visit.ts";
import styles from "./Booking.module.css";
import { Icon, StageDrawing } from "./Drawings.tsx";

interface Props {
  turnstileSiteKey: string;
  /** Outside production only: ?state= opens a state directly. */
  allowStateSwitch: boolean;
}

type State = "form" | "sending" | "booked" | "waitlist";
const STATES: readonly State[] = ["form", "sending", "booked", "waitlist"];

/** A stand-in answer for ?state=booked, with v2's own date. */
const SAMPLE_BOOKED: LeadResponse = {
  lead_id: "00000000-0000-4000-8000-000000000000",
  served: true,
  proposed_visit_date: "2026-09-24",
  window_label: "after six",
};

/** What the visitor is told when the API refuses; field errors show by their fields instead. */
function refusal(code: ErrorCode | "network"): string {
  if (code === "rate_limited") return booking.errors.rateLimited;
  if (code === "turnstile_failed") return booking.errors.turnstile;
  return booking.errors.other;
}

export default function Booking(props: Props) {
  const [state, setState] = useState<State>("form");
  const [cities, setCities] = useState<City[]>([]);
  const [citiesFailed, setCitiesFailed] = useState(false);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [city, setCity] = useState("");
  const [window, setWindow] = useState<VisitWindow>(booking.defaultWindow);
  const [extent, setExtent] = useState<LossExtent>("crown");
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<LeadResponse | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const turnstileBox = useRef<HTMLDivElement>(null);
  const turnstile = useRef<ReturnType<typeof turnstileWidget> | null>(null);

  const chosenCity = cities.find((candidate) => candidate.name === city);
  const nameBad = touched && name.trim() === "";
  const mobileBad = touched && !isCompleteMobile(mobile);
  const consentBad = touched && !consent;
  const shownMobile = mobile === "" ? booking.mobilePlaceholder : mobile;

  // The city list, in the API's order; the first is chosen, as in v2.
  useEffect(() => {
    void fetchCities().then((answer) => {
      if (!answer.ok) {
        setCitiesFailed(true);
        return;
      }
      setCities(answer.body);
      setCity((current) => (current === "" ? (answer.body[0]?.name ?? "") : current));
    });
  }, []);

  useEffect(() => {
    if (turnstileBox.current !== null)
      turnstile.current = turnstileWidget(turnstileBox.current, props.turnstileSiteKey);
  }, [props.turnstileSiteKey]);

  useEffect(() => {
    if (!props.allowStateSwitch) return;
    const wanted = new URLSearchParams(location.search).get("state");
    const found = STATES.find((candidate) => candidate === wanted);
    if (found === undefined) return;
    if (found === "booked") setResult(SAMPLE_BOOKED);
    if (found === "waitlist") setResult({ lead_id: SAMPLE_BOOKED.lead_id, served: false });
    setState(found);
  }, [props.allowStateSwitch]);

  // A waitlist state opened with ?state= names the first unserved city.
  useEffect(() => {
    if (state === "waitlist" && chosenCity?.served !== false && cities.length > 0) {
      setCity(cities.find((candidate) => !candidate.served)?.name ?? "");
    }
  }, [state, chosenCity, cities]);

  useEffect(() => {
    if (state === "booked" || state === "waitlist") {
      globalThis.scrollTo(0, 0);
      heading.current?.focus();
    }
  }, [state]);

  async function submit(event: Event) {
    event.preventDefault();
    if (state === "sending") return;
    if (name.trim() === "" || !isCompleteMobile(mobile) || !consent || chosenCity === undefined) {
      setTouched(true);
      return;
    }
    setState("sending");
    setFailure(null);
    const token = (await turnstile.current?.token()) ?? null;
    if (token === null) {
      setFailure(booking.errors.turnstile);
      setState("form");
      return;
    }
    const attribution = readAttribution();
    const answer = await submitLead(
      {
        name: name.trim(),
        mobile,
        city: chosenCity.name,
        first_choice_window: window,
        loss_extent: extent,
        consent: true,
        turnstile_token: token,
        ...(attribution === undefined ? {} : { attribution }),
      },
      crypto.randomUUID(),
    );
    void turnstile.current?.renew();
    if (!answer.ok) {
      if (answer.code === "invalid_request") setTouched(true);
      setFailure(refusal(answer.code));
      setState("form");
      return;
    }
    const served = answer.body.served;
    track({ name: "lead_submitted", first_choice_window: window, loss_extent: extent, city: chosenCity.name, served });
    track({ name: served ? "booking_confirmed" : "waitlist_submitted", city: chosenCity.name });
    setResult(answer.body);
    setState(answer.body.served ? "booked" : "waitlist");
  }

  const sending = state === "sending";
  const showForm = state === "form" || sending;
  return (
    <>
      <div class={styles.container}>
        {showForm && (
          <>
            <div>
              <h1 class={styles.title}>{booking.title}</h1>
              <p class={styles.intro}>{booking.intro}</p>
            </div>

            <form class={styles.card} onSubmit={(event) => void submit(event)} noValidate>
              <div class={styles.fields}>
                <div>
                  <label class={styles.label} for="book-name">
                    {booking.name}
                  </label>
                  <input
                    id="book-name"
                    class={`${styles.input} ${nameBad ? styles.bad : ""}`}
                    value={name}
                    placeholder={booking.namePlaceholder}
                    autocomplete="name"
                    aria-invalid={nameBad}
                    aria-describedby={nameBad ? "book-name-error" : undefined}
                    onInput={(event) => {
                      setName(event.currentTarget.value);
                    }}
                  />
                  <div aria-live="polite">
                    {nameBad && (
                      <div id="book-name-error" class={styles.error}>
                        {booking.nameError}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label class={styles.label} for="book-mobile">
                    {booking.mobile}
                  </label>
                  <div class={`${styles.mobile} ${mobileBad ? styles.bad : ""}`}>
                    <span class={styles.prefix}>+91</span>
                    <input
                      id="book-mobile"
                      class={styles.mobileInput}
                      value={mobile}
                      placeholder={booking.mobilePlaceholder}
                      inputMode="numeric"
                      autocomplete="tel-national"
                      aria-invalid={mobileBad}
                      aria-describedby={mobileBad ? "book-mobile-error" : undefined}
                      onInput={(event) => {
                        setMobile(formatMobile(event.currentTarget.value));
                      }}
                    />
                  </div>
                  <div aria-live="polite">
                    {mobileBad && (
                      <div id="book-mobile-error" class={styles.error}>
                        {booking.mobileError}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label class={styles.label} for="book-city">
                    {booking.city}
                  </label>
                  <div class={styles.select}>
                    <select
                      id="book-city"
                      value={city}
                      aria-describedby={chosenCity?.served === false ? "book-city-note" : undefined}
                      onChange={(event) => {
                        setCity(event.currentTarget.value);
                      }}
                    >
                      {cities.map((option) => (
                        <option key={option.name} value={option.name}>
                          {option.served ? option.name : `${option.name}${booking.comingSoon}`}
                        </option>
                      ))}
                    </select>
                    <Icon path={ICONS.selectArrow} size={15} />
                  </div>
                  {chosenCity?.served === false && (
                    <div id="book-city-note" class={styles.note}>
                      {fill(booking.notServed, { city })}
                    </div>
                  )}
                  {citiesFailed && <div class={styles.error}>{booking.errors.cities}</div>}
                </div>

                <fieldset class={styles.group}>
                  <legend class={styles.label}>{booking.window}</legend>
                  <div class={styles.slots}>
                    {visitWindows.map((option) => (
                      <label key={option.id} class={`${styles.slot} ${window === option.id ? styles.slotOn : ""}`}>
                        <input
                          type="radio"
                          name="window"
                          class="visually-hidden"
                          checked={window === option.id}
                          onChange={() => {
                            setWindow(option.id);
                          }}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>

              <fieldset class={`${styles.group} ${styles.extentGroup}`}>
                <legend class={`${styles.label} ${styles.extentLabel}`}>{booking.extent}</legend>
                <div class={styles.extents}>
                  {stageOptions.map((option) => (
                    <label key={option.id} class={`${styles.extent} ${extent === option.id ? styles.extentOn : ""}`}>
                      <input
                        type="radio"
                        name="extent"
                        class="visually-hidden"
                        checked={extent === option.id}
                        onChange={() => {
                          setExtent(option.id);
                        }}
                      />
                      <StageDrawing hair={option.hair} zone={option.zone} size="small" />
                      <span class={styles.extentText}>{option.short}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label class={styles.consent}>
                <input
                  type="checkbox"
                  class="visually-hidden"
                  checked={consent}
                  aria-invalid={consentBad}
                  aria-describedby={consentBad ? "book-consent-error" : undefined}
                  onChange={(event) => {
                    setConsent(event.currentTarget.checked);
                  }}
                />
                <span class={`${styles.box} ${consentBad ? styles.bad : ""}`} aria-hidden="true">
                  {consent && <Icon path={ICONS.tick} size={13} stroke={1.7} />}
                </span>
                <span class={styles.consentText}>{booking.consent}</span>
              </label>
              <div aria-live="polite">
                {consentBad && (
                  <div id="book-consent-error" class={`${styles.error} ${styles.consentError}`}>
                    {booking.consentError}
                  </div>
                )}
              </div>

              {/* Turnstile shows here only if Cloudflare needs the visitor to act. */}
              <div ref={turnstileBox} class={styles.turnstile} />
              <div aria-live="polite">{failure !== null && <div class={styles.failure}>{failure}</div>}</div>

              <button type="submit" class={styles.submit} aria-disabled={sending}>
                {sending && <Icon path={ICONS.sending} size={15} stroke={1.7} />}
                {sending ? booking.sending : booking.submit}
              </button>
              <div class={styles.reply}>{booking.reply}</div>
            </form>
          </>
        )}
      </div>

      {state === "booked" && result !== null && <Booked result={result} mobile={shownMobile} heading={heading} />}
      {state === "waitlist" && <Waitlist city={city} mobile={shownMobile} heading={heading} />}
    </>
  );
}

function Booked(props: { result: LeadResponse; mobile: string; heading: { current: HTMLHeadingElement | null } }) {
  const { proposed_visit_date: date, window_label: windowLabel } = props.result;
  const dated = date !== undefined && windowLabel !== undefined;
  const rows = booking.booked.rows;
  return (
    <div class={styles.done}>
      <span class={styles.tick}>
        <Icon path={ICONS.tick} size={30} stroke={1.7} />
      </span>
      <h1 ref={props.heading} tabIndex={-1} class={styles.doneTitle}>
        {dated ? bookedHeadline(date, windowLabel) : booking.booked.noDate}
      </h1>
      <p class={styles.doneBody}>{booking.booked.confirmation}</p>
      <dl class={styles.rows}>
        {[rows.what, rows.howLong, rows.pay, rows.where].map((row) => (
          <div key={row.k} class={styles.row}>
            <dt>{row.k}</dt>
            <dd>{row.v}</dd>
          </div>
        ))}
        <div class={styles.row}>
          <dt>{rows.confirming.k}</dt>
          <dd class={styles.number}>{`+91 ${props.mobile}`}</dd>
        </div>
      </dl>
      <p class={styles.doneNote}>{booking.booked.discretion}</p>
      <div class={styles.doneActions}>
        {dated && (
          <button
            type="button"
            class="btn btn--lg btn--ink"
            onClick={() => {
              downloadFile(
                "mane-man-measurement.ics",
                "text/calendar",
                measurementCalendar(date, windowLabel, props.result.lead_id, new Date()),
              );
            }}
          >
            {booking.booked.calendar}
          </button>
        )}
        <a class="btn btn--lg btn--line-on-paper" href="/">
          {booking.booked.back}
        </a>
      </div>
    </div>
  );
}

function Waitlist(props: { city: string; mobile: string; heading: { current: HTMLHeadingElement | null } }) {
  const { waitlist } = booking;
  return (
    <div class={styles.done}>
      <div class={`caps ${styles.onTheList}`}>{waitlist.label}</div>
      <h1 ref={props.heading} tabIndex={-1} class={`${styles.doneTitle} ${styles.waitlistTitle}`}>
        {fill(waitlist.title, { city: props.city })}
      </h1>
      <p class={styles.doneBody}>{fill(waitlist.body, { city: props.city })}</p>
      <dl class={styles.rows}>
        <div class={styles.row}>
          <dt>{waitlist.rows.city}</dt>
          <dd>{props.city}</dd>
        </div>
        <div class={styles.row}>
          <dt>{waitlist.rows.number}</dt>
          <dd class={styles.number}>{`+91 ${props.mobile}`}</dd>
        </div>
        <div class={styles.row}>
          <dt>{waitlist.rows.expected}</dt>
          <dd>{waitlist.expected}</dd>
        </div>
      </dl>
      <p class={styles.doneNote}>{waitlist.note}</p>
      <div class={styles.doneActions}>
        <a class="btn btn--lg btn--ink" href="/try">
          {waitlist.tryOn}
        </a>
        <a class="btn btn--lg btn--line-on-paper" href="/">
          {waitlist.back}
        </a>
      </div>
    </div>
  );
}
