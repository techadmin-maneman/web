// Admin · Targets (docs/decisions/0154-targets-and-reporting-access.md): each month's plan, city by city, by measure,
// which the nightly reporting copy carries for every scorecard to set beside the actual. A city's measures are each
// changed where they read (docs/decisions/0212-editing-in-place.md); an emptied one is taken off. Beneath, every target
// the month holds, to compare.

import { whoWords } from "../lib/who.ts";
import { Field, Select } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import type { Success } from "@maneman/web-kit/api";
import { fullMonth } from "@maneman/web-kit/dates";
import { quantity } from "@maneman/web-kit/figures";
import { errorText } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import type { paths } from "../api-schema.ts";
import { FigureRow } from "../components/RecordRows.tsx";
import { targets as copy } from "../content/targets.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import form from "../components/forms.module.css";
import { targetsApi } from "./targets-api.ts";

type Targets = Success<paths["/api/targets"]["get"]>;
type Measure = Targets["measures"][number];

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
    <Field label={props.label} className={form.field}>
      {(control) => (
        <Select
          {...control}
          width="choice"
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

/** A city's target for each measure this month, each changed where it reads. */
function CityTargets({ list, city, onSaved }: { list: Targets; city: string; onSaved: (list: Targets) => void }) {
  const mayChange = useAccess().mayCall("POST /api/targets");
  const mayRemove = useAccess().mayCall("POST /api/targets/remove");
  const save = (measure: Measure, set: number | null) => async (typed: string) => {
    // A target runs to crores, as Indian figures are written: "1,00,00,000".
    const text = typed.replaceAll(",", "").trim();
    if (text !== "" && !/^\d{1,9}$/.test(text)) return copy.errors.invalid_request;
    const figure = text === "" ? null : Number(text);
    if (figure === null && set === null) return null;
    if (figure === null && !mayRemove) return copy.errors.not_permitted;
    const answer =
      figure === null
        ? await targetsApi.removeTarget({ month: list.month, city, measure })
        : await targetsApi.setTarget({ month: list.month, city, measure, target: figure });
    if (!answer.ok) return errorText(copy.errors, answer);
    onSaved(answer.body);
    return null;
  };
  return (
    <div className={form.record}>
      {list.measures.map((measure) => {
        const set = list.targets.find((each) => each.city === city && each.measure === measure)?.target ?? null;
        return (
          <FigureRow
            key={`${city}/${measure}`}
            label={copy.measures[measure]}
            value={set}
            shown={set === null ? copy.notSet : quantity(set)}
            mayChange={mayChange}
            save={save(measure, set)}
          />
        );
      })}
    </div>
  );
}

/** Every target the month holds, to compare. */
function TargetTable({ list }: { list: Targets }) {
  if (list.targets.length === 0) return <Note>{copy.none}</Note>;
  return (
    <Table>
      <thead>
        <tr>
          {Object.values(copy.columns).map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {list.targets.map((target) => (
          <tr key={`${target.city}/${target.measure}`}>
            <td>{target.city}</td>
            <td>{copy.measures[target.measure]}</td>
            <td>{quantity(target.target)}</td>
            <td>{whoWords(target.set_by)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function MonthTargets({ month, onMonth }: { month: string | null; onMonth: (month: string) => void }) {
  const load = useCallback(() => targetsApi.targets(month === null ? {} : { month }), [month]);
  const [loaded, retry] = useLoad(load);
  const [saved, setSaved] = useState<Targets | null>(null);
  const [city, setCity] = useState<string | null>(null);
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
      <TargetChoice
        label={copy.city}
        value={city ?? list.cities[0] ?? ""}
        options={list.cities.map((each) => [each, each])}
        onChange={setCity}
      />
      <CityTargets list={list} city={city ?? list.cities[0] ?? ""} onSaved={setSaved} />
      <h3 className={form.ruleTitle}>{copy.all}</h3>
      <TargetTable list={list} />
    </>
  );
}

export function TargetsScreen() {
  const [month, setMonth] = useState<string | null>(null);
  return (
    <div className={form.screen}>
      <Panel titleId="targets" title={copy.title} padded>
        <MonthTargets key={month ?? "now"} month={month} onMonth={setMonth} />
      </Panel>
    </div>
  );
}
