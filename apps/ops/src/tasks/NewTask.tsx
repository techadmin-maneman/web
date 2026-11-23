// A task written by hand on Tasks (docs/decisions/0302-tasks-written-by-hand.md): what needs doing, the department it is
// for, a client if it is about one, when it is due, and whose it is. Written, it is on that department's board; one
// about no client is in the city chosen in the header, or here where the header names none.

import { Button } from "@maneman/ui/Button";
import { Drawer } from "@maneman/ui/Drawer";
import { DateInput, Field, Select, TextInput } from "@maneman/ui/Field";
import { Refused } from "@maneman/ui/Refusal";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { apiNow } from "@maneman/web-kit/clock";
import { indiaInstant, todayInIndia } from "@maneman/web-kit/dates";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { DEPARTMENTS, type Department } from "@rules/policy/access.ts";
import { useState } from "react";
import { CLOSE, tasks } from "../content.ts";
import { staffName } from "../lib/who.ts";
import { ClientChoice, type Found } from "./ClientChoice.tsx";
import { tasksApi } from "./tasks-api.ts";
import styles from "./task-actions.module.css";

const copy = tasks.write;
const TITLE_ID = "new-task-title";
const HOUR_MS = 60 * 60 * 1000;

/** Due by default two hours on, on the hour, in India. */
function dueByDefault(): { day: string; time: string } {
  const later = apiNow() + 2 * HOUR_MS;
  const hour = new Date(later + 5.5 * HOUR_MS).getUTCHours();
  return { day: todayInIndia(later), time: `${String(hour).padStart(2, "0")}:00` };
}

interface Due {
  readonly day: string;
  readonly time: string;
}

/** When it is due: a day and a time, in India. */
function DueChoice(props: { due: Due; busy: boolean; failure: Failure | null; onDue: (due: Due) => void }) {
  const { due, busy } = props;
  return (
    <div className={styles.due}>
      <Field label={copy.day} error={boxError(copy.errors, props.failure, "due")}>
        {(control) => (
          <DateInput
            {...control}
            required
            value={due.day}
            disabled={busy}
            onChange={(event) => {
              props.onDue({ ...due, day: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label={copy.time}>
        {(control) => (
          <TextInput
            {...control}
            type="time"
            required
            value={due.time}
            disabled={busy}
            onChange={(event) => {
              props.onDue({ ...due, time: event.target.value });
            }}
          />
        )}
      </Field>
    </div>
  );
}

/** The boxes the panel draws, each of which says its own refusal; any other is said beneath them. */
const shownBoxes = (mayFind: boolean, asksCity: boolean): string[] => [
  "what",
  "due",
  "owner",
  ...(mayFind ? ["client"] : []),
  ...(asksCity ? ["city"] : []),
];

/** What needs doing, in the writer's words. */
function WhatBox(props: { value: string; busy: boolean; failure: Failure | null; onWhat: (what: string) => void }) {
  return (
    <Field label={copy.what} error={boxError(copy.errors, props.failure, "what")}>
      {(control) => (
        <TextInput
          {...control}
          maxLength={200}
          value={props.value}
          disabled={props.busy}
          onChange={(event) => {
            props.onWhat(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

/** Where a task about no client is, chosen where the header names no city and the writer's work reaches some alone. */
function CityChoice(props: {
  cities: readonly string[];
  value: string;
  busy: boolean;
  failure: Failure | null;
  onChoose: (city: string) => void;
}) {
  return (
    <Field label={copy.city} error={boxError(copy.errors, props.failure, "city")}>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={props.value}
          disabled={props.busy}
          onChange={(event) => {
            props.onChoose(event.target.value);
          }}
        >
          <option value="">{copy.chooseCity}</option>
          {props.cities.map((each) => (
            <option key={each} value={each}>
              {each}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** The department it is for, whose people see it. */
function DepartmentChoice(props: { value: Department; busy: boolean; onChoose: (department: Department) => void }) {
  return (
    <Field label={copy.department}>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={props.value}
          disabled={props.busy}
          onChange={(event) => {
            props.onChoose(DEPARTMENTS.find((each) => each === event.target.value) ?? props.value);
          }}
        >
          {DEPARTMENTS.map((each) => (
            <option key={each} value={each}>
              {tasks.departments[each]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** Whose it is from the start: nobody yet, the writer, or another who uses the console. */
function OwnerChoice(props: {
  value: string;
  me: string | null;
  staff: readonly string[];
  busy: boolean;
  failure: Failure | null;
  onChoose: (owner: string) => void;
}) {
  const others = props.staff.filter((each) => each !== props.me);
  return (
    <Field label={copy.owner} error={boxError(copy.errors, props.failure, "owner")}>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={props.value}
          disabled={props.busy}
          onChange={(event) => {
            props.onChoose(event.target.value);
          }}
        >
          <option value="">{copy.nobody}</option>
          {props.me !== null && <option value={props.me}>{copy.me}</option>}
          {others.map((each) => (
            <option key={each} value={each}>
              {staffName(each)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function NewTask(props: {
  /** The department it is for at first: the writer's own. */
  readonly department: Department;
  /** The header's city, where a task about no client is; null for every city. */
  readonly city: string | null;
  /** The cities the writer's work reaches, to choose from where the header names none; null where it reaches every one. */
  readonly cities: readonly string[] | null;
  /** Whether the writer may look clients up; a task is about nobody otherwise. */
  readonly mayFind: boolean;
  readonly me: string | null;
  readonly staff: readonly string[];
  readonly onAdded: () => void;
  readonly onDismiss: () => void;
}) {
  const [what, setWhat] = useState("");
  const [department, setDepartment] = useState<Department>(props.department);
  const [client, setClient] = useState<Found | null>(null);
  const [due, setDue] = useState<Due>(dueByDefault);
  const [owner, setOwner] = useState("");
  const [chosenCity, setChosenCity] = useState("");
  const asksCity = client === null && props.city === null && props.cities !== null;
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, once] = useOneAtATime();
  const add = () =>
    once(async () => {
      setFailure(null);
      const answer = await tasksApi.writeTask({
        what: what.trim(),
        department,
        client: client?.id ?? null,
        city: client === null ? (props.city ?? (chosenCity === "" ? null : chosenCity)) : null,
        due: indiaInstant(due.day, due.time).toISOString(),
        owner: owner === "" ? null : owner,
      });
      if (answer.ok) props.onAdded();
      else setFailure({ code: answer.code, fields: answer.fields });
    });
  return (
    <Drawer
      titleId={TITLE_ID}
      title={copy.title}
      close={CLOSE}
      onDismiss={props.onDismiss}
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
      foot={
        <div className={styles.footEnd}>
          <Button variant="primary" size="small" type="submit" busy={busy}>
            {busy ? copy.adding : copy.add}
          </Button>
        </div>
      }
    >
      <div className={styles.newTask}>
        <WhatBox value={what} busy={busy} failure={failure} onWhat={setWhat} />
        <DepartmentChoice value={department} busy={busy} onChoose={setDepartment} />
        {props.mayFind && <ClientChoice chosen={client} busy={busy} failure={failure} onChoose={setClient} />}
        {asksCity && (
          <CityChoice cities={props.cities} value={chosenCity} busy={busy} failure={failure} onChoose={setChosenCity} />
        )}
        <DueChoice due={due} busy={busy} failure={failure} onDue={setDue} />
        <OwnerChoice
          value={owner}
          me={props.me}
          staff={props.staff}
          busy={busy}
          failure={failure}
          onChoose={setOwner}
        />
      </div>
      <Refused failed={failure} errors={copy.errors} boxes={shownBoxes(props.mayFind, asksCity)} />
    </Drawer>
  );
}
