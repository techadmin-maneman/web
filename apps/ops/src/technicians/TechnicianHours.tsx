// A technician's Hours tab (docs/decisions/0210-booking-by-start-time.md): the days they work and their hours, changed
// where they read (docs/decisions/0212-editing-in-place.md), and the place their day starts from. Booking offers a start
// only inside their hours, and counts the drive to their first visit from that place. A technician with no week of their
// own works their city's hours every day.

import { typeLook } from "@maneman/ui/type";
import { AddressSearch } from "@maneman/ui/AddressSearch";
import { Button } from "@maneman/ui/Button";
import { EditableRow } from "@maneman/ui/EditableRow";
import { Checkbox, Field, Select } from "@maneman/ui/Field";
import { dayClock } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useRef, useState } from "react";
import type { Technician } from "../api.ts";
import { FormActions } from "../components/FormActions.tsx";
import { EDITING } from "../content/common.ts";
import { technicians } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { useWrite } from "../lib/write.ts";
import { Refused } from "../components/Refusal.tsx";
import form from "../components/forms.module.css";
import shared from "./technicians.module.css";
import styles from "./technician-hours.module.css";
import { techniciansApi } from "./technicians-api.ts";

const copy = technicians.hours;

type Day = Technician["hours"][number];

/** The week as ops read it, Monday first. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

/** Every quarter hour a working day may start or end on, 5 am to 11:45 pm. */
const TIMES = Array.from({ length: 76 }, (_, index) => {
  const minutes = 5 * 60 + index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

const nameOf = (weekday: number): string => copy.weekdays[weekday] ?? "";

/** The week in lines: each run of days with the same hours, then the days off. */
export function weekLines(days: readonly Day[]): string[] {
  if (days.length === 0) return [copy.city];
  const lines: string[] = [];
  let run: Day[] = [];
  const close = () => {
    const [first] = run;
    const last = run.at(-1);
    if (first !== undefined && last !== undefined) {
      const span = copy.run(nameOf(first.weekday), nameOf(last.weekday));
      lines.push(copy.line(span, dayClock(first.starts), dayClock(first.ends)));
    }
    run = [];
  };
  for (const weekday of WEEK) {
    const day = days.find((each) => each.weekday === weekday);
    const previous = run.at(-1);
    if (
      day === undefined ||
      (previous !== undefined && (day.starts !== previous.starts || day.ends !== previous.ends))
    ) {
      close();
    }
    if (day !== undefined) run.push(day);
  }
  close();
  const off = WEEK.filter((weekday) => !days.some((day) => day.weekday === weekday));
  if (off.length > 0) lines.push(copy.off(off.map(nameOf).join(", ")));
  return lines;
}

/** A week as it is changed: the days worked and their hours, or the city's hours every day. */
interface Week {
  readonly city: boolean;
  readonly worked: readonly number[];
  readonly starts: string;
  readonly ends: string;
}

const weekOf = (hours: readonly Day[]): Week => ({
  city: hours.length === 0,
  worked: hours.length === 0 ? [...WEEK] : hours.map((day) => day.weekday),
  starts: hours[0]?.starts ?? "09:00",
  ends: hours[0]?.ends ?? "20:00",
});

/** The week's boxes: the city's hours, or the days worked and when they start and end. */
function WeekBoxes({ week, onWeek }: { week: Week; onWeek: (week: Week) => void }) {
  const toggle = (weekday: number) => {
    onWeek({
      ...week,
      worked: week.worked.includes(weekday)
        ? week.worked.filter((each) => each !== weekday)
        : [...week.worked, weekday],
    });
  };
  return (
    <span className={styles.form}>
      <Checkbox
        label={copy.useCity}
        checked={week.city}
        onChange={(event) => {
          onWeek({ ...week, city: event.target.checked });
        }}
      />
      {!week.city && (
        <>
          <span className={styles.days} role="group" aria-label={copy.worksOn}>
            {WEEK.map((weekday) => (
              <Checkbox
                key={weekday}
                label={nameOf(weekday)}
                checked={week.worked.includes(weekday)}
                onChange={() => {
                  toggle(weekday);
                }}
              />
            ))}
          </span>
          <span className={form.fields}>
            <TimeField
              label={copy.starts}
              value={week.starts}
              onChange={(starts) => {
                onWeek({ ...week, starts });
              }}
            />
            <TimeField
              label={copy.ends}
              value={week.ends}
              onChange={(ends) => {
                onWeek({ ...week, ends });
              }}
            />
          </span>
        </>
      )}
    </span>
  );
}

/** The technician's week, changed where it reads. */
function WeekRow(props: { technician: Technician; mayChange: boolean; onChange: () => Promise<void> }) {
  const { technician } = props;
  return (
    <EditableRow<Week>
      label={copy.title}
      words={EDITING}
      mayChange={props.mayChange}
      value={
        <span className={styles.lines}>
          {weekLines(technician.hours).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      }
      start={() => weekOf(technician.hours)}
      save={async (week) => {
        if (!week.city && week.worked.length === 0) return copy.errors.no_days;
        if (!week.city && week.ends <= week.starts) return copy.errors.ends;
        const days = week.city ? [] : week.worked.map((weekday) => ({ weekday, starts: week.starts, ends: week.ends }));
        const answer = await techniciansApi.setHours(technician.id, days);
        if (!answer.ok) return errorText(copy.errors, answer);
        await props.onChange();
        return null;
      }}
    >
      {(control, week, setWeek) => (
        <span id={control.id}>
          <WeekBoxes week={week} onWeek={setWeek} />
        </span>
      )}
    </EditableRow>
  );
}

export function TimeField(props: { label: string; value: string; onChange: (time: string) => void }) {
  return (
    <Field label={props.label}>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        >
          {TIMES.map((time) => (
            <option key={time} value={time}>
              {dayClock(time)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function HomeForm(props: { technician: Technician; onDone: () => void; onCancel: () => void }) {
  const session = useRef(crypto.randomUUID());
  const [typed, setTyped] = useState("");
  const { busy, failure, send } = useWrite<unknown>(props.onDone);
  return (
    <div className={styles.form}>
      <AddressSearch
        value={typed}
        search={async (query) => {
          const answer = await techniciansApi.homeSuggestions(props.technician.id, query, session.current);
          return answer.ok ? { ok: true, suggestions: answer.body.suggestions } : { ok: false };
        }}
        onType={setTyped}
        onChoose={(chosen) => {
          setTyped(chosen.primary);
          void send(() => techniciansApi.setHome(props.technician.id, chosen.place_id, session.current));
        }}
        words={{ ...copy.search, hint: null }}
      />
      <FormActions>
        <Button variant="outline" size="small" narrow disabled={busy} onClick={props.onCancel}>
          {copy.cancel}
        </Button>
      </FormActions>
      <Refused failed={failure} errors={copy.errors} />
    </div>
  );
}

export function Hours({ technician, onChange }: { technician: Technician; onChange: () => Promise<void> }) {
  const access = useAccess();
  const maySetHome = access.mayCall("POST /api/technicians/{id}/home");
  const [home, setHome] = useState(false);
  const done = () => {
    setHome(false);
    void onChange();
  };
  const close = () => {
    setHome(false);
  };
  return (
    <div className={styles.hours}>
      <section className={styles.part} aria-label={copy.title}>
        <WeekRow
          technician={technician}
          mayChange={access.mayCall("POST /api/technicians/{id}/hours")}
          onChange={onChange}
        />
      </section>
      <section className={styles.part} aria-label={copy.home}>
        <h3 className={typeLook("title-4", shared.sectionTitle)}>{copy.home}</h3>
        <p className={styles.home}>{technician.home?.label ?? copy.noHome}</p>
        {home && <HomeForm technician={technician} onDone={done} onCancel={close} />}
        {!home && maySetHome && (
          <div className={shared.actions}>
            <Button
              variant="outline"
              size="small"
              onClick={() => {
                setHome(true);
              }}
            >
              {technician.home === null ? copy.setHome : copy.changeHome}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
