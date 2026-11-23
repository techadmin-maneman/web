// A task written by hand on Tasks (docs/decisions/0302-tasks-written-by-hand.md): what needs doing, the department it is
// for, a client if it is about one, when it is due, and whose it is. Written, it is on that department's board; one
// about no client is in the city chosen in the header.

import { Button, RowButton } from "@maneman/ui/Button";
import { Drawer } from "@maneman/ui/Drawer";
import { DateInput, Field, Select, TextInput } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Refused } from "@maneman/ui/Refusal";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { apiNow } from "@maneman/web-kit/clock";
import { indiaInstant, todayInIndia } from "@maneman/web-kit/dates";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { DEPARTMENTS, type Department } from "@rules/policy/access.ts";
import { useState } from "react";
import { api, type ClientsFound } from "../api.ts";
import { CLOSE, tasks } from "../content.ts";
import { staffName } from "../lib/who.ts";
import { tasksApi } from "./tasks-api.ts";
import styles from "./task-actions.module.css";

const copy = tasks.write;
const TITLE_ID = "new-task-title";
const HOUR_MS = 60 * 60 * 1000;
const BOXES = ["what", "department", "client", "due", "owner", "city"];

/** Two letters of a name, or four digits of a number, as the client search asks. */
const searchable = (text: string): boolean => /\p{L}.*\p{L}/u.test(text) || text.replace(/\D/g, "").length >= 4;

/** Due by default two hours on, on the hour, in India. */
function dueByDefault(): { day: string; time: string } {
  const later = apiNow() + 2 * HOUR_MS;
  const hour = new Date(later + 5.5 * HOUR_MS).getUTCHours();
  return { day: todayInIndia(later), time: `${String(hour).padStart(2, "0")}:00` };
}

type Found = ClientsFound["clients"][number];

/** The client a task is about: found by name or number and chosen, or none. */
function ClientChoice(props: {
  chosen: Found | null;
  busy: boolean;
  failure: Failure | null;
  onChoose: (client: Found | null) => void;
}) {
  const [text, setText] = useState("");
  const [found, setFound] = useState<readonly Found[] | null>(null);
  if (props.chosen !== null)
    return (
      <Field label={copy.client}>
        {() => (
          <p className={styles.chosen}>
            {copy.chosen(props.chosen?.name ?? "", props.chosen?.mobile ?? "")}{" "}
            <RowButton
              beside
              disabled={props.busy}
              onClick={() => {
                props.onChoose(null);
              }}
            >
              {copy.change}
            </RowButton>
          </p>
        )}
      </Field>
    );
  const find = async () => {
    const answer = await api.findClients(text.trim());
    setFound(answer.ok ? answer.body.clients : []);
  };
  return (
    <>
      <div className={styles.find}>
        <Field label={copy.client} error={boxError(copy.errors, props.failure, "client")}>
          {(control) => (
            <TextInput
              {...control}
              maxLength={60}
              value={text}
              disabled={props.busy}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          )}
        </Field>
        <Button variant="outline" size="control" disabled={!searchable(text)} onClick={() => void find()}>
          {copy.find}
        </Button>
      </div>
      {found !== null && found.length === 0 && <Note>{copy.noneFound}</Note>}
      {found !== null && found.length > 0 && (
        <ul className={styles.found}>
          {found.map((client) => (
            <li key={client.id}>
              {copy.chosen(client.name, client.mobile)}{" "}
              <RowButton
                beside
                aria-label={copy.chooseLabel(client.name)}
                onClick={() => {
                  props.onChoose(client);
                }}
              >
                {copy.choose}
              </RowButton>
            </li>
          ))}
        </ul>
      )}
    </>
  );
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
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, once] = useOneAtATime();
  const add = () =>
    once(async () => {
      setFailure(null);
      const answer = await tasksApi.writeTask({
        what: what.trim(),
        department,
        client: client?.id ?? null,
        city: client === null ? props.city : null,
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
        <Button variant="primary" size="small" type="submit" busy={busy} disabled={what.trim() === ""}>
          {busy ? copy.adding : copy.add}
        </Button>
      }
    >
      <div className={styles.newTask}>
        <Field label={copy.what} error={boxError(copy.errors, failure, "what")}>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={what}
              disabled={busy}
              onChange={(event) => {
                setWhat(event.target.value);
              }}
            />
          )}
        </Field>
        <DepartmentChoice value={department} busy={busy} onChoose={setDepartment} />
        <ClientChoice chosen={client} busy={busy} failure={failure} onChoose={setClient} />
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
      <Refused failed={failure} errors={copy.errors} boxes={BOXES} />
    </Drawer>
  );
}
