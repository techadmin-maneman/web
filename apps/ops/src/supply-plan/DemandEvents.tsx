// The events calendar on the Supply plan (docs/decisions/0182-the-events-calendar.md): the events still to end, each
// taken off with a press, and one added with its city, its days and how much it lifts or drops demand.

import { Button } from "@maneman/ui/Button";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { supplyPlan } from "../content/supply-plan.ts";
import { useAccess } from "../lib/access.ts";
import { dayAfter } from "./Forecast.tsx";

export type Calendar = paths["/api/demand-events"]["get"]["responses"][200]["content"]["application/json"];

type Answer =
  | { readonly ok: true; readonly body: Calendar }
  | { readonly ok: false; readonly code: string; readonly fields: readonly string[] };

const copy = supplyPlan.events;

const EMPTY = { name: "", city: "", startsOn: "", endsOn: "", percent: "" };

function Entry(props: { label: string; value: string; type?: string; onChange: (text: string) => void }) {
  return (
    <Field label={props.label} className={form.field}>
      {(control) => (
        <TextInput
          {...control}
          type={props.type ?? "text"}
          maxLength={80}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

/** An event added: its name, its city or every city, its days, and how much it changes demand. */
function AddEvent({ cities, onAnswer }: { cities: readonly string[]; onAnswer: (answer: Answer) => boolean }) {
  const [draft, setDraft] = useState(EMPTY);
  const edit = (field: keyof typeof EMPTY) => (text: string) => {
    setDraft((was) => ({ ...was, [field]: text }));
  };
  const percent = Number(draft.percent);
  const ready =
    draft.name.trim() !== "" &&
    draft.startsOn !== "" &&
    draft.endsOn !== "" &&
    draft.percent.trim() !== "" &&
    Number.isInteger(percent);
  const add = async () => {
    const answer = await client.post("/api/demand-events", {
      body: {
        name: draft.name.trim(),
        city: draft.city === "" ? null : draft.city,
        starts_on: draft.startsOn,
        ends_on: draft.endsOn,
        uplift_percent: percent,
      },
    });
    if (onAnswer(answer)) setDraft(EMPTY);
  };
  return (
    <div className={form.group}>
      <h3 className={form.panelTitle}>{copy.add}</h3>
      <Entry label={copy.name} value={draft.name} onChange={edit("name")} />
      <Field label={copy.city} className={form.field}>
        {(control) => (
          <Select
            {...control}
            className={form.choiceBox}
            value={draft.city}
            onChange={(event) => {
              edit("city")(event.target.value);
            }}
          >
            <option value="">{supplyPlan.everyCity}</option>
            {cities.map((each) => (
              <option key={each} value={each}>
                {each}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Entry label={copy.startsOn} type="date" value={draft.startsOn} onChange={edit("startsOn")} />
      <Entry label={copy.endsOn} type="date" value={draft.endsOn} onChange={edit("endsOn")} />
      <Entry label={copy.percent} type="number" value={draft.percent} onChange={edit("percent")} />
      <div className={form.actions}>
        <Button variant="primary" size="small" disabled={!ready} onClick={() => void add()}>
          {copy.save}
        </Button>
      </div>
    </div>
  );
}

/** One event, taken off with a press by those who may. */
function EventRow({
  event,
  mayRemove,
  onAnswer,
}: {
  event: Calendar["events"][number];
  mayRemove: boolean;
  onAnswer: (answer: Answer) => boolean;
}) {
  return (
    <tr>
      <th scope="row" className={form.rowHead}>
        {event.name}
      </th>
      <td>{event.city ?? supplyPlan.everyCity}</td>
      <td>{copy.days(dayAfter(event.starts_on, 0), dayAfter(event.ends_on, 0, true))}</td>
      <td className={form.figure}>{copy.change(event.uplift_percent)}</td>
      <td>
        {mayRemove && (
          <Button
            variant="outline"
            size="small"
            aria-label={copy.remove(event.name)}
            onClick={() =>
              void client.post("/api/demand-events/{id}/remove", { path: { id: event.id } }).then(onAnswer)
            }
          >
            {copy.removeShort}
          </Button>
        )}
      </td>
    </tr>
  );
}

export function EventsPanel({ calendar }: { calendar: Calendar }) {
  const access = useAccess();
  const [book, setBook] = useState(calendar);
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const answered = (words: string) => (answer: Answer) => {
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      setSaid(null);
      return false;
    }
    setBook(answer.body);
    setSaid(words);
    setFailure(null);
    return true;
  };
  const mayRemove = access.mayCall("POST /api/demand-events/{id}/remove");
  return (
    <section className={form.panel} aria-labelledby="plan-events">
      <div className={form.panelHead}>
        <h2 className={form.panelTitle} id="plan-events">
          {copy.title}
        </h2>
      </div>
      <p className={form.note}>{copy.note}</p>
      {book.events.length === 0 ? (
        <p className={form.note}>{copy.none}</p>
      ) : (
        <Table className={form.table}>
          <thead>
            <tr>
              {copy.columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {book.events.map((event) => (
              <EventRow key={event.id} event={event} mayRemove={mayRemove} onAnswer={answered(copy.removed)} />
            ))}
          </tbody>
        </Table>
      )}
      {access.mayCall("POST /api/demand-events") && <AddEvent cities={book.cities} onAnswer={answered(copy.added)} />}
      {said !== null && (
        <p className={form.saved} role="status">
          {said}
        </p>
      )}
      {failure !== null && (
        <p className={form.error} role="alert">
          {errorText(copy.errors, failure)}
        </p>
      )}
    </section>
  );
}
