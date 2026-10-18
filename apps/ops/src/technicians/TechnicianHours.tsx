// A technician's Hours tab (docs/decisions/0210-booking-by-start-time.md): the days they work and their hours, and the
// place their day starts from. Booking offers a start only inside their hours, and counts the drive to their first
// visit from that place. A technician with no week of their own works their city's hours every day.

import { AddressSearch } from "@maneman/ui/AddressSearch";
import { Button } from "@maneman/ui/Button";
import { Checkbox, Field, Fieldset, Select } from "@maneman/ui/Field";
import { dayClock } from "@maneman/web-kit/dates";
import { useRef, useState } from "react";
import type { Technician } from "../api.ts";
import { FormActions } from "../components/FormActions.tsx";
import { technicians } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { useWrite } from "../lib/write.ts";
import { Refused } from "../settings/index.ts";
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

function HoursForm(props: { technician: Technician; onDone: () => void; onCancel: () => void }) {
  const { hours } = props.technician;
  const [worked, setWorked] = useState<readonly number[]>(
    hours.length === 0 ? [...WEEK] : hours.map((day) => day.weekday),
  );
  const [starts, setStarts] = useState(hours[0]?.starts ?? "09:00");
  const [ends, setEnds] = useState(hours[0]?.ends ?? "20:00");
  const { busy, failure, send } = useWrite<unknown>(props.onDone);
  const toggle = (weekday: number) => {
    setWorked((was) => (was.includes(weekday) ? was.filter((each) => each !== weekday) : [...was, weekday]));
  };
  const week = worked.map((weekday) => ({ weekday, starts, ends }));
  return (
    <div className={styles.form}>
      <Fieldset legend={copy.worksOn}>
        <div className={styles.days}>
          {WEEK.map((weekday) => (
            <Checkbox
              key={weekday}
              label={nameOf(weekday)}
              checked={worked.includes(weekday)}
              onChange={() => {
                toggle(weekday);
              }}
            />
          ))}
        </div>
      </Fieldset>
      <div className={form.fields}>
        <TimeField label={copy.starts} value={starts} onChange={setStarts} />
        <TimeField label={copy.ends} value={ends} onChange={setEnds} />
      </div>
      <FormActions>
        <Button
          variant="primary"
          size="small"
          disabled={busy || worked.length === 0 || ends <= starts}
          onClick={() => void send(() => techniciansApi.setHours(props.technician.id, week))}
        >
          {copy.save}
        </Button>
        <Button
          variant="outline"
          size="small"
          disabled={busy}
          onClick={() => void send(() => techniciansApi.setHours(props.technician.id, []))}
        >
          {copy.useCity}
        </Button>
        <Button variant="outline" size="small" narrow onClick={props.onCancel}>
          {copy.cancel}
        </Button>
      </FormActions>
      <Refused failed={failure} errors={copy.errors} />
    </div>
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

type Open = "none" | "hours" | "home";

export function Hours({ technician, onChange }: { technician: Technician; onChange: () => Promise<void> }) {
  const access = useAccess();
  const maySetHours = access.mayCall("POST /api/technicians/{id}/hours");
  const maySetHome = access.mayCall("POST /api/technicians/{id}/home");
  const [open, setOpen] = useState<Open>("none");
  const done = () => {
    setOpen("none");
    void onChange();
  };
  const close = () => {
    setOpen("none");
  };
  return (
    <div className={styles.hours}>
      <section className={styles.part} aria-label={copy.title}>
        <h3 className={shared.sectionTitle}>{copy.title}</h3>
        <ul className={styles.lines}>
          {weekLines(technician.hours).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {open === "hours" && <HoursForm technician={technician} onDone={done} onCancel={close} />}
        {open !== "hours" && maySetHours && (
          <div className={shared.actions}>
            <Button
              variant="outline"
              size="small"
              aria-label={copy.setLabel(technician.name)}
              onClick={() => {
                setOpen("hours");
              }}
            >
              {copy.set}
            </Button>
          </div>
        )}
      </section>
      <section className={styles.part} aria-label={copy.home}>
        <h3 className={shared.sectionTitle}>{copy.home}</h3>
        <p className={styles.home}>{technician.home?.label ?? copy.noHome}</p>
        {open === "home" && <HomeForm technician={technician} onDone={done} onCancel={close} />}
        {open !== "home" && maySetHome && (
          <div className={shared.actions}>
            <Button
              variant="outline"
              size="small"
              onClick={() => {
                setOpen("home");
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
