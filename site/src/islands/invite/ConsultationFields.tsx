// The consultation form's own fieldsets (./Consultation.tsx): what to book, the discount code on the site's own page,
// the day strip, and the windows on the day picked. Each window and day the API says is full is drawn, and disabled.

import { messageLook } from "@maneman/ui/InlineMessage";
import { ChoiceCard } from "@maneman/ui/ChoiceCard";
import { DateStrip } from "@maneman/ui/DateStrip";
import { Fieldset, Label, TextInput } from "@maneman/ui/Field";
import { TextLink } from "@maneman/ui/TextLink";
import { WindowChoice } from "@maneman/ui/WindowChoice";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { referral } from "../../content/referral.ts";
import { whatsapp } from "../../content/site.ts";
import type { OpenWindows } from "../../lib/api.ts";
import { stripMonths, type StripDay } from "../../lib/dates.ts";
import { dayOpen, hoursOn, isOpen, startsIn, type OpenDays, type Slot } from "../../lib/open-windows.ts";
import { TimeChoice } from "@maneman/ui/TimeChoice";
import { dayClock } from "@maneman/web-kit/dates";
import shared from "./Invite.module.css";
import styles from "./consultation-fields.module.css";

const { consultation } = referral;

type Plan = OpenWindows["plan"];
type WindowOption = (typeof consultation.windows)[number];

/** What to book: the consultation alone, or the consultation and fit in one visit, which the API refuses while ops offer
 * no hair system. */
export function PlanChoice({ plan, onPlanChange }: { plan: Plan; onPlanChange: (plan: Plan) => void }) {
  const choices = consultation.plan;
  return (
    <Fieldset legend={choices.legend} legendLook="caps">
      <div class={styles.windows}>
        {choices.options.map((option) => (
          <ChoiceCard
            key={option.id}
            name="plan"
            className={styles.window}
            checked={plan === option.id}
            onChange={() => {
              onPlanChange(option.id);
            }}
          >
            <span class={shared.windowLabel}>{option.label}</span>
          </ChoiceCard>
        ))}
      </div>
      {plan === "one_visit" && <p class={shared.planNote}>{choices.note}</p>}
    </Fieldset>
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
      <Label htmlFor="invite-consultation-code">{consultation.code.label}</Label>
      <TextInput
        id="invite-consultation-code"
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
        <div id="invite-consultation-code-error" class={messageLook({ tone: "error", className: shared.error })}>
          {referral.errors.codeNotApplicable}
        </div>
      )}
      <p id="invite-consultation-code-hint" class={shared.hint}>
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
    <Fieldset legend={consultation.date} legendLook="caps">
      {nothingOpen && (
        <p class={shared.planNote}>
          {consultation.noneOpen}{" "}
          <TextLink href={whatsappChat(whatsapp.number)} newTab inline>
            {consultation.noneOpenAction}
          </TextLink>
        </p>
      )}
      <p class={shared.months}>{stripMonths(days)}</p>
      <DateStrip
        name="date"
        days={days.map((day) => ({ ...day, open: dayOpen(open, day.date, windowIds) }))}
        chosen={slot.date}
        onChoose={onDay}
      />
    </Fieldset>
  );
}

/**
 * The starts on the day picked, under the windows the plan may start in, open or taken
 * (docs/decisions/0210-booking-by-start-time.md); or, before the day's starts are known, the windows themselves, a full
 * one saying so in place of its hours.
 */
export function DayWindows({
  windows,
  slot,
  open,
  onWindow,
  onStart,
}: {
  windows: readonly WindowOption[];
  slot: Slot;
  open: OpenDays | null;
  onWindow: (window: Slot["window"]) => void;
  onStart: (window: Slot["window"], start: string) => void;
}) {
  const periods = windows.map(({ id, label }) => ({
    name: label,
    times: startsIn(open, slot.date, id).map((start) => ({
      id: start.starts_at,
      label: dayClock(start.time),
      open: start.open,
    })),
  }));
  if (periods.some((period) => period.times.length > 0)) {
    return (
      <Fieldset legend={consultation.window} legendLook="caps">
        <TimeChoice
          name="start"
          periods={periods}
          chosen={slot.start}
          fullWord={consultation.fullyBooked}
          takenWord={consultation.taken}
          onChoose={(start) => {
            const window = windows.find((option) =>
              startsIn(open, slot.date, option.id).some((each) => each.starts_at === start),
            );
            if (window !== undefined) onStart(window.id, start);
          }}
        />
      </Fieldset>
    );
  }
  return (
    <WindowChoice
      name="window"
      legend={consultation.window}
      options={windows.map(({ id, label }) => ({
        id,
        name: label,
        hours: hoursOn(open, slot.date, id),
        open: isOpen(open, slot.date, id),
      }))}
      chosen={slot.window}
      fullWord={consultation.full}
      onChoose={onWindow}
    />
  );
}
