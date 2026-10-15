// The forecast on the Supply plan (docs/decisions/0182-the-events-calendar.md): one city at a time, each item's expected
// use in each period of the latest run, with its high case; and beneath, how right the forecasts before it were.

import type { Success } from "@maneman/web-kit/api";
import { addDays, dayMonth, fullDate, todayInIndia } from "@maneman/web-kit/dates";
import { quantity } from "@maneman/web-kit/figures";
import { Panel } from "@maneman/ui/Panel";
import { Field, Select } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Table, TableScroll } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { useCallback, useState } from "react";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { supplyPlan } from "../content/supply-plan.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { AccuracyPart } from "./Accuracy.tsx";
import styles from "./forecast.module.css";
import { RowHead } from "../components/RowHead.tsx";
import { supplyPlanApi } from "./supply-plan-api.ts";

type Forecast = Success<paths["/api/stock/forecast"]["get"]>;

const copy = supplyPlan.forecast;
/** "21 Sep", or with its year, of the day `days` after an ISO date. */
export function dayAfter(date: string, days: number, year = false): string {
  const day = addDays(date, days);
  return year ? fullDate(day) : dayMonth(day);
}

function Periods({ forecast, city }: { forecast: Forecast; city: string }) {
  const { run } = forecast;
  if (run === null) return <Note>{copy.none}</Note>;
  if (forecast.lines.length === 0) return <Note>{copy.empty(city)}</Note>;
  const items = new Map<string, { name: string; periods: Map<number, Forecast["lines"][number]> }>();
  for (const line of forecast.lines) {
    const item = items.get(line.consumable_code) ?? { name: line.name, periods: new Map() };
    item.periods.set(line.period, line);
    items.set(line.consumable_code, item);
  }
  const ranOn = dayAfter(run.run_on, 0, true);
  // The periods not yet over: one past is no longer a plan.
  const today = todayInIndia(Date.now());
  const periods = Array.from({ length: run.horizon_periods }, (_, period) => period).filter(
    (period) => addDays(run.run_on, (period + 1) * run.period_days) > today,
  );
  if (periods.length === 0) return <Note>{copy.stale(ranOn)}</Note>;
  return (
    <>
      <Note>{copy.note(run.period_days, ranOn)}</Note>
      <TableScroll labelledBy="plan-forecast">
        <Table controls className={styles.forecast}>
          <thead>
            <tr>
              <th scope="col">{copy.item}</th>
              {periods.map((period) => (
                <th key={period} scope="col" className={form.figure}>
                  {dayAfter(run.run_on, period * run.period_days)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...items].map(([code, item]) => (
              <tr key={code}>
                <RowHead>{item.name}</RowHead>
                {periods.map((period) => {
                  const line = item.periods.get(period);
                  return (
                    <td key={period} className={form.figure}>
                      {quantity(line?.expected ?? 0)}
                      {line !== undefined && line.high > line.expected && (
                        <span className={styles.high}>{copy.high(quantity(line.high))}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </>
  );
}

export function ForecastPanel({ cities }: { cities: readonly string[] }) {
  const [city, setCity] = useState(cities[0] ?? "");
  const load = useCallback(() => supplyPlanApi.forecast({ city }), [city]);
  const [loaded, retry] = useLoad(load);
  return (
    <Panel titleId="plan-forecast" title={copy.title}>
      <Field label={copy.city} className={form.field}>
        {(control) => (
          <Select
            {...control}
            width="choice"
            value={city}
            onChange={(event) => {
              setCity(event.target.value);
            }}
          >
            {cities.map((each) => (
              <option key={each} value={each}>
                {each}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && <Periods forecast={loaded.value} city={city} />}
      <AccuracyPart city={city} />
    </Panel>
  );
}
