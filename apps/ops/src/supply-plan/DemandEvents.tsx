// The events calendar on the Supply plan (docs/decisions/0182-the-events-calendar.md): the events still to end, each
// taken off with a press, and one added with its city, its days and how much it lifts or drops demand.

import type { Success } from "@maneman/web-kit/api";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { supplyPlan } from "../content/supply-plan.ts";
import { useAccess } from "../lib/access.ts";
import { dayAfter } from "./Forecast.tsx";
import { Refusal } from "../components/Refusal.tsx";
import { RowHead } from "../components/RowHead.tsx";
import { FormActions } from "../components/FormActions.tsx";
import { supplyPlanApi } from "./supply-plan-api.ts";

export type Calendar = Success<paths["/api/demand-events"]["get"]>;

type Answer =
  | { readonly ok: true; readonly body: Calendar }
  | { readonly ok: false; readonly code: string; readonly fields: readonly string[] };

const copy = supplyPlan.events;

const EMPTY = { name: "", city: "", startsOn: "", endsOn: "", percent: "" };

function DemandEntry(props: { label: string; value: string; type?: string; onChange: (text: string) => void }) {
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
    const answer = await supplyPlanApi.addDemandEvent({
      name: draft.name.trim(),
      city: draft.city === "" ? null : draft.city,
      starts_on: draft.startsOn,
      ends_on: draft.endsOn,
      uplift_percent: percent,
    });
    if (onAnswer(answer)) setDraft(EMPTY);
  };
  return (
    <div className={form.group}>
      <h3 className={form.ruleTitle}>{copy.add}</h3>
      <DemandEntry label={copy.name} value={draft.name} onChange={edit("name")} />
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
      <DemandEntry label={copy.startsOn} type="date" value={draft.startsOn} onChange={edit("startsOn")} />
      <DemandEntry label={copy.endsOn} type="date" value={draft.endsOn} onChange={edit("endsOn")} />
      <DemandEntry label={copy.percent} type="number" value={draft.percent} onChange={edit("percent")} />
      <FormActions>
        <Button variant="primary" size="small" disabled={!ready} onClick={() => void add()}>
          {copy.save}
        </Button>
      </FormActions>
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
      <RowHead>{event.name}</RowHead>
      <td>{event.city ?? supplyPlan.everyCity}</td>
      <td>{copy.days(dayAfter(event.starts_on, 0), dayAfter(event.ends_on, 0, true))}</td>
      <td className={form.figure}>{copy.change(event.uplift_percent)}</td>
      <td>
        {mayRemove && (
          <Button
            variant="outline"
            size="small"
            aria-label={copy.remove(event.name)}
            onClick={() => void supplyPlanApi.removeDemandEvent(event.id).then(onAnswer)}
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
  const [demand, setDemand] = useState(calendar);
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const answered = (words: string) => (answer: Answer) => {
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      setSaid(null);
      return false;
    }
    setDemand(answer.body);
    setSaid(words);
    setFailure(null);
    return true;
  };
  const mayRemove = access.mayCall("POST /api/demand-events/{id}/remove");
  return (
    <Panel titleId="plan-events" title={copy.title}>
      <p className={form.note}>{copy.note}</p>
      {demand.events.length === 0 ? (
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
            {demand.events.map((event) => (
              <EventRow key={event.id} event={event} mayRemove={mayRemove} onAnswer={answered(copy.removed)} />
            ))}
          </tbody>
        </Table>
      )}
      {access.mayCall("POST /api/demand-events") && <AddEvent cities={demand.cities} onAnswer={answered(copy.added)} />}
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
      {failure !== null && <Refusal className={form.error} said={errorText(copy.errors, failure)} />}
    </Panel>
  );
}
