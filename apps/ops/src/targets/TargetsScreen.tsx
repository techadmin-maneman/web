// Admin · Targets (docs/decisions/0154-targets-and-reporting-access.md): each month's plan, city by city, by measure,
// which the nightly reporting copy carries for every scorecard to set beside the actual.

import { whoWords } from "../lib/who.ts";
import { Button, RowButton } from "@maneman/ui/Button";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import type { Sent, Success } from "@maneman/web-kit/api";
import { fullMonth } from "@maneman/web-kit/dates";
import type { Failure } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import { targets as copy } from "../content/targets.ts";
import { useAccess } from "../lib/access.ts";
import { Refused } from "../settings/index.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import form from "../components/forms.module.css";

type Targets = Success<paths["/api/targets"]["get"]>;
type Measure = Targets["measures"][number];
type TargetChange = Sent<paths["/api/targets"]["post"]>;

/** Each month from the first a target may be set in to the last, in order. */
function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  for (let month = first; month <= last;) {
    months.push(month);
    const [year = 0, number = 1] = month.split("-").map(Number);
    month = number === 12 ? `${String(year + 1)}-01` : `${String(year)}-${String(number + 1).padStart(2, "0")}`;
  }
  return months;
}

function TargetChoice(props: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <Field label={props.label}>
      {(control) => (
        <Select
          {...control}
          className={form.choiceBox}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        >
          {props.options.map(([value, words]) => (
            <option key={value} value={value}>
              {words}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function TargetForm({ list, onSaved }: { list: Targets; onSaved: (list: Targets) => void }) {
  const [city, setCity] = useState(list.cities[0] ?? "");
  const [measure, setMeasure] = useState<Measure>(list.measures[0] ?? "new_clients");
  const [typed, setTyped] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const set = async () => {
    setFailure(null);
    const change: TargetChange = { month: list.month, city, measure, target: Number(typed) };
    const answer = await client.post("/api/targets", { body: change });
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      return;
    }
    setTyped("");
    onSaved(answer.body);
  };
  return (
    <div className={form.group}>
      <TargetChoice
        label={copy.city}
        value={city}
        options={list.cities.map((each) => [each, each])}
        onChange={setCity}
      />
      <TargetChoice
        label={copy.measure}
        value={measure}
        options={list.measures.map((each) => [each, copy.measures[each]])}
        onChange={(value) => {
          setMeasure(list.measures.find((each) => each === value) ?? measure);
        }}
      />
      <Field label={copy.target}>
        {(control) => (
          <TextInput
            {...control}
            inputMode="numeric"
            maxLength={8}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        )}
      </Field>
      <Button variant="outline" size="small" disabled={!/^\d+$/.test(typed.trim())} onClick={() => void set()}>
        {copy.set}
      </Button>
      <Refused failed={failure} errors={copy.errors} />
    </div>
  );
}

function TargetTable({ list, onSaved }: { list: Targets; onSaved: (list: Targets) => void }) {
  const mayRemove = useAccess().mayCall("POST /api/targets/remove");
  const [failure, setFailure] = useState<Failure | null>(null);
  if (list.targets.length === 0) return <p className={form.note}>{copy.none}</p>;
  const remove = async (city: string, measure: Measure) => {
    setFailure(null);
    const answer = await client.post("/api/targets/remove", { body: { month: list.month, city, measure } });
    if (answer.ok) onSaved(answer.body);
    else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <>
      <Refused failed={failure} errors={copy.errors} />
      <Table className={form.table}>
        <thead>
          <tr>
            {Object.values(copy.columns).map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
            {mayRemove && <th scope="col" />}
          </tr>
        </thead>
        <tbody>
          {list.targets.map((target) => (
            <tr key={`${target.city}/${target.measure}`}>
              <td>{target.city}</td>
              <td>{copy.measures[target.measure]}</td>
              <td>{target.target.toLocaleString("en-IN")}</td>
              <td>{whoWords(target.set_by)}</td>
              {mayRemove && (
                <td>
                  <RowButton
                    className={form.inline}
                    aria-label={copy.removeLabel(target.city, copy.measures[target.measure])}
                    onClick={() => void remove(target.city, target.measure)}
                  >
                    {copy.remove}
                  </RowButton>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

function MonthTargets({ month, onMonth }: { month: string | null; onMonth: (month: string) => void }) {
  const load = useCallback(() => client.get("/api/targets", { query: month === null ? {} : { month } }), [month]);
  const [loaded, retry] = useLoad(load);
  const [saved, setSaved] = useState<Targets | null>(null);
  const mayChange = useAccess().mayCall("POST /api/targets");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const list = saved ?? loaded.value;
  return (
    <>
      <TargetChoice
        label={copy.month}
        value={list.month}
        options={monthsBetween(list.first_month, list.last_month).map((each) => [each, fullMonth(each)])}
        onChange={onMonth}
      />
      {mayChange && <TargetForm list={list} onSaved={setSaved} />}
      <TargetTable list={list} onSaved={setSaved} />
    </>
  );
}

export function TargetsScreen() {
  const [month, setMonth] = useState<string | null>(null);
  return (
    <div className={form.screen}>
      <Panel titleId="targets" title={copy.title} className={form.panel}>
        <p className={form.note}>{copy.intro}</p>
        <MonthTargets key={month ?? "now"} month={month} onMonth={setMonth} />
      </Panel>
    </div>
  );
}
