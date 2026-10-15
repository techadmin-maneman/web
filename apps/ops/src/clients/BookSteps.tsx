// Book a visit's steps (./BookVisit.tsx): what is booked, when and with whom, and the strip of days moved a fortnight
// at a time.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Button } from "@maneman/ui/Button";
import { addDays, clockWords, shortDate } from "@maneman/web-kit/dates";
import { type VisitAvailability } from "../api.ts";
import { dispatch } from "../content.ts";
import styles from "../components/visit-dialog.module.css";
import { Choose } from "./book-choices.tsx";
import { CHOICES, copy, kindOf, STRIP_DAYS, type Choice, type Picked, type slotOf } from "./book-slot.ts";

/** The fortnight before the one shown, and the one after. */
export function StripButtons(props: {
  readonly busy: boolean;
  readonly from: string | undefined;
  readonly firstDay: string | undefined;
  readonly onFrom: (from: string | undefined) => void;
}) {
  const { busy, firstDay, onFrom } = props;
  return (
    <div className={styles.days}>
      <Button
        variant="outline"
        size="small"
        className={styles.quiet}
        disabled={busy || props.from === undefined}
        onClick={() => {
          onFrom(firstDay === undefined ? undefined : addDays(firstDay, -STRIP_DAYS));
        }}
      >
        {copy.earlier}
      </Button>
      <Button
        variant="outline"
        size="small"
        className={styles.quiet}
        disabled={busy || firstDay === undefined}
        onClick={() => {
          onFrom(firstDay === undefined ? undefined : addDays(firstDay, STRIP_DAYS));
        }}
      >
        {copy.later}
      </Button>
    </div>
  );
}

/** What is booked: the kind of visit, the service or hair system, and a word where it is not the one recommended. */
export function WhatIsBooked(props: {
  choice: Choice;
  offered: VisitAvailability;
  busy: boolean;
  onChoice: (choice: Choice) => void;
  onTier: (tier: string) => void;
}) {
  const { choice, offered, busy, onChoice, onTier } = props;
  return (
    <>
      <Choose
        label={copy.kind}
        value={choice}
        options={CHOICES.map((each) => ({ value: each, label: copy.kinds[each] }))}
        busy={busy}
        onChoose={(next) => {
          onChoice(next as Choice);
        }}
      />
      {offered.services.length > 1 && (
        <Choose
          label={kindOf(choice) === "first_fit" ? copy.hairSystem : copy.service}
          value={offered.service.tier}
          options={offered.services.map((service) => ({ value: service.tier, label: service.name }))}
          busy={busy}
          onChoose={onTier}
        />
      )}
      {offered.recommended !== null && offered.recommended !== offered.service.tier && (
        <InlineMessage tone="note">
          {copy.notRecommended(
            offered.services.find((service) => service.tier === offered.recommended)?.name ?? offered.recommended,
          )}
        </InlineMessage>
      )}
    </>
  );
}

/** When and with whom: the day, its window and the technician, each of what the day has open. */
export function WhenAndWho({
  slot,
  busy,
  onPick,
}: {
  slot: ReturnType<typeof slotOf>;
  busy: boolean;
  onPick: (next: Partial<Picked>) => void;
}) {
  const { days, day, windows, window, technicians, technician } = slot;
  return (
    <>
      {day === undefined ? (
        <p className={styles.note}>{copy.noDays}</p>
      ) : (
        <>
          <Choose
            label={copy.day}
            value={day.date}
            options={days.map((each) => ({ value: each.date, label: shortDate(each.date) }))}
            busy={busy}
            onChoose={(date) => {
              onPick({ date });
            }}
          />
          <Choose
            label={copy.window}
            value={window?.window ?? ""}
            options={windows.map((each) => ({
              value: each.window,
              label: copy.windowChoice(dispatch.windows[each.window], clockWords(each.start), clockWords(each.end)),
            }))}
            busy={busy}
            onChoose={(next) => {
              onPick({ window: next });
            }}
          />
          <Choose
            label={copy.technician}
            value={technician}
            options={[
              { value: "", label: copy.anyone },
              ...technicians.map((each) => ({ value: each.id, label: each.name })),
            ]}
            busy={busy}
            onChoose={(next) => {
              onPick({ technician: next });
            }}
          />
        </>
      )}
    </>
  );
}
