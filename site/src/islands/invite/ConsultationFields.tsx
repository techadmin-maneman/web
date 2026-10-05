// The consultation form's own fieldsets (./Consultation.tsx): what to book, the discount code on the site's own page,
// the day strip, and the windows on the day picked. Each window and day the API says is full is drawn, and disabled.

import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { referral } from "../../content/referral.ts";
import { whatsapp } from "../../content/site.ts";
import type { OpenWindows } from "../../lib/api.ts";
import { stripMonths, type StripDay } from "../../lib/dates.ts";
import { dayOpen, isOpen, type OpenDays, type Slot } from "../../lib/open-windows.ts";
import styles from "./Invite.module.css";

const { consultation } = referral;

type Plan = OpenWindows["plan"];
type WindowOption = (typeof consultation.windows)[number];

/** What to book: the consultation alone, or the consultation and fit in one visit while ops offer a hair system. */
export function PlanChoice({
  plan,
  oneVisitOffered,
  onPlanChange,
}: {
  plan: Plan;
  oneVisitOffered: boolean;
  onPlanChange: (plan: Plan) => void;
}) {
  const choices = consultation.plan;
  const options = choices.options.filter((option) => option.id === "consultation" || oneVisitOffered);
  return (
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
                onPlanChange(option.id);
              }}
            />
            <span class={styles.windowLabel}>{option.label}</span>
          </label>
        ))}
      </div>
      {plan === "one_visit" && <p class={styles.planNote}>{choices.note}</p>}
      {!oneVisitOffered && <p class={styles.planNote}>{choices.notYet}</p>}
    </fieldset>
  );
}

/** A discount code for the one visit, on the site's own page (ADR 0108); a refused one is told only that. */
export function DiscountCode({
  code,
  refused,
  onCode,
}: {
  code: string;
  refused: boolean;
  onCode: (code: string) => void;
}) {
  return (
    <div>
      <label class={styles.label} for="invite-consultation-code">
        {consultation.code.label}
      </label>
      <input
        id="invite-consultation-code"
        class={`${styles.input} ${refused ? styles.bad : ""}`}
        value={code}
        autocomplete="off"
        autocapitalize="characters"
        spellcheck={false}
        aria-invalid={refused}
        aria-describedby={
          refused ? "invite-consultation-code-error invite-consultation-code-hint" : "invite-consultation-code-hint"
        }
        onInput={(event) => {
          onCode(event.currentTarget.value);
        }}
      />
      {refused && (
        <div id="invite-consultation-code-error" class={styles.error}>
          {referral.errors.codeNotApplicable}
        </div>
      )}
      <p id="invite-consultation-code-hint" class={styles.hint}>
        {consultation.code.hint}
      </p>
    </div>
  );
}

/** The days to pick from, a day with no window open disabled; and, with none open at all, WhatsApp for the next. */
export function DayStrip({
  days,
  slot,
  open,
  windowIds,
  nothingOpen,
  onDay,
}: {
  days: readonly StripDay[];
  slot: Slot;
  open: OpenDays | null;
  windowIds: readonly Slot["window"][];
  nothingOpen: boolean;
  onDay: (date: string) => void;
}) {
  return (
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
              disabled={!dayOpen(open, day.date, windowIds)}
              onChange={() => {
                onDay(day.date);
              }}
            />
            <span class={styles.dayName}>{day.weekday}</span>
            <span class={styles.dayNumber}>{day.number}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The windows the plan may start in, on the day picked: a full one says so. */
export function WindowChoice({
  windows,
  slot,
  open,
  onWindow,
}: {
  windows: readonly WindowOption[];
  slot: Slot;
  open: OpenDays | null;
  onWindow: (window: Slot["window"]) => void;
}) {
  return (
    <fieldset class={styles.group}>
      <legend class={`caps ${styles.legend}`}>{consultation.window}</legend>
      <div class={styles.windows}>
        {windows.map((option) => {
          const { id } = option;
          const windowOpen = isOpen(open, slot.date, id);
          return (
            <label key={id} class={`${styles.window} ${slot.window === id ? styles.windowOn : ""}`}>
              <input
                type="radio"
                name="window"
                class="visually-hidden"
                checked={slot.window === id}
                disabled={!windowOpen}
                onChange={() => {
                  onWindow(id);
                }}
              />
              <span class={styles.windowLabel}>{option.label}</span>
              <span class={styles.windowHours}>{windowOpen ? option.hours : consultation.full}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
