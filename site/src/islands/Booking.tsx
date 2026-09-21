// The booking form and its booked and waitlist states, as v2 draws them. F1
// is the shell: the form validates and submits to a stand-in (props.submit),
// which F2 replaces with POST /api/lead.
//
// Outside production, ?state=<form|sending|booked|waitlist> opens a state
// directly, for the fidelity screenshots and the browser tests.

import { useEffect, useRef, useState } from "preact/hooks";
import type { LossExtent, VisitWindow } from "../../../src/config/booking.ts";
import { booking, stageOptions, visitWindows } from "../content/site.ts";
import { bookedHeadline } from "../lib/dates.ts";
import { ICONS } from "../lib/icons.ts";
import { formatMobile, isCompleteMobile } from "../lib/phone.ts";
import { fill } from "../lib/text.ts";
import styles from "./Booking.module.css";
import { Icon, StageDrawing } from "./Drawings.tsx";

export interface City {
  readonly name: string;
  readonly served: boolean;
}

/** What the page needs back from a booking: the API's answer, in F2. */
export interface BookingResult {
  readonly served: boolean;
  /** The proposed visit day, YYYY-MM-DD, when served. */
  readonly proposedVisitDate: string | null;
  /** "before noon" or "after six", when served. */
  readonly windowLabel: string | null;
}

interface Props {
  cities: readonly City[];
  /** Outside production only: ?state= opens a state directly. */
  allowStateSwitch: boolean;
}

type State = "form" | "sending" | "booked" | "waitlist";
const STATES: readonly State[] = ["form", "sending", "booked", "waitlist"];

/** F1's stand-in for POST /api/lead: served cities get a visit two days out. */
function standIn(city: City, window: VisitWindow): Promise<BookingResult> {
  if (!city.served) return Promise.resolve({ served: false, proposedVisitDate: null, windowLabel: null });
  const visit = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const label = window.endsWith("_am") ? "before noon" : "after six";
  return Promise.resolve({ served: true, proposedVisitDate: visit, windowLabel: label });
}

export default function Booking(props: Props) {
  const firstCity = props.cities[0]?.name ?? "";
  const [state, setState] = useState<State>("form");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [city, setCity] = useState(firstCity);
  const [window, setWindow] = useState<VisitWindow>(booking.defaultWindow);
  const [extent, setExtent] = useState<LossExtent>("crown");
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<BookingResult | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const chosenCity = props.cities.find((candidate) => candidate.name === city);
  const nameBad = touched && name.trim() === "";
  const mobileBad = touched && !isCompleteMobile(mobile);
  const consentBad = touched && !consent;
  const shownMobile = mobile === "" ? booking.mobilePlaceholder : mobile;

  useEffect(() => {
    if (!props.allowStateSwitch) return;
    const wanted = new URLSearchParams(location.search).get("state");
    const found = STATES.find((candidate) => candidate === wanted);
    if (found === undefined) return;
    if (found === "booked") setResult({ served: true, proposedVisitDate: "2026-09-24", windowLabel: "after six" });
    if (found === "waitlist") {
      setCity(props.cities.find((candidate) => !candidate.served)?.name ?? firstCity);
      setResult({ served: false, proposedVisitDate: null, windowLabel: null });
    }
    setState(found);
  }, [props.allowStateSwitch, props.cities, firstCity]);

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
    const answer = await standIn(chosenCity, window);
    setResult(answer);
    setState(answer.served ? "booked" : "waitlist");
  }

  if (state === "booked") {
    const date = result?.proposedVisitDate ?? null;
    const label = result?.windowLabel ?? null;
    const headline = date !== null && label !== null ? bookedHeadline(date, label) : "";
    const rows = booking.booked.rows;
    return (
      <div class={styles.done}>
        <span class={styles.tick}>
          <Icon path={ICONS.tick} size={30} stroke={1.7} />
        </span>
        <h1 ref={heading} tabIndex={-1} class={styles.doneTitle}>
          {headline}
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
            <dd class={styles.number}>{`+91 ${shownMobile}`}</dd>
          </div>
        </dl>
        <p class={styles.doneNote}>{booking.booked.discretion}</p>
        <div class={styles.doneActions}>
          <button type="button" class="btn btn--lg btn--ink">
            {booking.booked.calendar}
          </button>
          <a class="btn btn--lg btn--line-on-paper" href="/">
            {booking.booked.back}
          </a>
        </div>
      </div>
    );
  }

  if (state === "waitlist") {
    const { waitlist } = booking;
    return (
      <div class={styles.done}>
        <div class={`caps ${styles.onTheList}`}>{waitlist.label}</div>
        <h1 ref={heading} tabIndex={-1} class={`${styles.doneTitle} ${styles.waitlistTitle}`}>
          {fill(waitlist.title, { city })}
        </h1>
        <p class={styles.doneBody}>{fill(waitlist.body, { city })}</p>
        <dl class={styles.rows}>
          <div class={styles.row}>
            <dt>{waitlist.rows.city}</dt>
            <dd>{city}</dd>
          </div>
          <div class={styles.row}>
            <dt>{waitlist.rows.number}</dt>
            <dd class={styles.number}>{`+91 ${shownMobile}`}</dd>
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

  const sending = state === "sending";
  return (
    <div class={styles.layout}>
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
                {props.cities.map((option) => (
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

        <button type="submit" class={styles.submit} aria-disabled={sending}>
          {sending && <Icon path={ICONS.sending} size={15} stroke={1.7} />}
          {sending ? booking.sending : booking.submit}
        </button>
        <div class={styles.reply}>{booking.reply}</div>
      </form>
    </div>
  );
}
