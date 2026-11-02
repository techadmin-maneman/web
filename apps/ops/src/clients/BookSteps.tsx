// Book a visit's steps (./BookVisit.tsx), numbered: the visit, a card a kind; the day, from a strip of the fortnight
// offered, each with how many starts are free, moved a fortnight at a time; and the time, under its part of the day,
// with the technician, whoever is free unless ops choose.

import { Button } from "@maneman/ui/Button";
import { ChoiceCard } from "@maneman/ui/ChoiceCard";
import { DateStrip } from "@maneman/ui/DateStrip";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { TimeChoice, type TimePeriod } from "@maneman/ui/TimeChoice";
import { typeLook } from "@maneman/ui/type";
import { addDays, dayClock, shortDate, weekdayDate } from "@maneman/web-kit/dates";
import { type VisitAvailability } from "../api.ts";
import styles from "./visit-dialog.module.css";
import { Choose } from "./book-choices.tsx";
import { CHOICES, copy, kindOf, STRIP_DAYS, type Choice, type Picked, type slotOf } from "./book-slot.ts";

type Day = VisitAvailability["days"][number];

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

/** A step's name, numbered, over what it asks. */
function Step({ id, number, name }: { id: string; number: number; name: string }) {
  return (
    <h3 id={id} className={typeLook("title-4", styles.step)}>
      {copy.step(number, name)}
    </h3>
  );
}

/** What is booked: the kind of visit, a card each; the service or hair system; a word where it is not recommended. */
export function WhatIsBooked(props: {
  choice: Choice;
  offered: VisitAvailability;
  busy: boolean;
  onChoice: (choice: Choice) => void;
  onTier: (tier: string) => void;
}) {
  const { choice, offered, busy, onChoice, onTier } = props;
  return (
    <section className={styles.section} aria-labelledby="book-kind">
      <Step id="book-kind" number={1} name={copy.kind} />
      <div className={styles.kinds} role="radiogroup" aria-labelledby="book-kind">
        {CHOICES.map((each) => (
          <ChoiceCard
            key={each}
            name="book-kind"
            checked={choice === each}
            disabled={busy}
            onChange={() => {
              onChoice(each);
            }}
          >
            {copy.kinds[each]}
          </ChoiceCard>
        ))}
      </div>
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
    </section>
  );
}

/** A day's starts under its parts of the day, each a time to choose. */
function periodsOf(day: Day | undefined): TimePeriod[] {
  if (day === undefined) return [];
  return day.windows.map((window) => ({
    name: copy.periods[window.window],
    times: day.starts
      .filter((start) => start.time >= window.start && start.time < window.end)
      .map((start) => ({ id: start.starts_at, label: dayClock(start.time), open: true })),
  }));
}

/** When and with whom: the day, from the strip; its time, under its part of the day; and the technician. */
export function WhenAndWho({
  offered,
  slot,
  chosen,
  busy,
  onPick,
}: {
  offered: VisitAvailability;
  slot: ReturnType<typeof slotOf>;
  /** The start chosen, or the first in the window asked for; null until one is. */
  chosen: string | null;
  busy: boolean;
  onPick: (next: Partial<Picked>) => void;
}) {
  const { day, technicians, technician } = slot;
  return (
    <>
      <section className={styles.section} aria-labelledby="book-day">
        <Step id="book-day" number={2} name={copy.day} />
        <DateStrip
          name="book-day"
          labelledBy="book-day"
          days={offered.days.map((each) => ({
            date: each.date,
            weekday: shortDate(each.date).split(" ")[0] ?? "",
            number: String(Number(each.date.slice(8))),
            label: `${weekdayDate(each.date)}, ${copy.free(each.starts.length)}`,
            open: each.starts.length > 0 && !busy,
            note: copy.free(each.starts.length),
          }))}
          chosen={day?.date ?? null}
          onChoose={(date) => {
            onPick({ date, start: undefined, window: undefined });
          }}
        />
      </section>
      <section className={styles.section} aria-labelledby="book-time">
        <Step id="book-time" number={3} name={copy.time} />
        {day === undefined ? (
          <p className={styles.note}>{copy.noDays}</p>
        ) : (
          <>
            <TimeChoice
              name="book-time"
              labelledBy="book-time"
              periods={periodsOf(day)}
              chosen={chosen}
              fullWord={copy.full}
              takenWord={copy.taken}
              onChoose={(start) => {
                onPick({ start });
              }}
            />
            <Choose
              label={copy.technician}
              value={technician}
              options={[
                { value: "", label: copy.anyone },
                ...technicians.map((each) => ({
                  value: each.id,
                  label: copy.withDrive(each.name, each.added_drive_minutes),
                })),
              ]}
              busy={busy}
              onChoose={(next) => {
                onPick({ technician: next });
              }}
            />
          </>
        )}
      </section>
    </>
  );
}
