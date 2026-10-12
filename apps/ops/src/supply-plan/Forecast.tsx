// The forecast on the Supply plan (docs/decisions/0182-the-events-calendar.md): one city at a time, each item's expected
// use in each period of the latest run, with its high case; and beneath, how right the forecasts before it were.

import { Field, Select } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { useCallback, useState } from "react";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { supplyPlan } from "../content/supply-plan.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { AccuracyPart } from "./Accuracy.tsx";
import own from "./supply-plan.module.css";

type Forecast = paths["/api/stock/forecast"]["get"]["responses"][200]["content"]["application/json"];

const copy = supplyPlan.forecast;
const DAY = 24 * 60 * 60 * 1000;

/** "21 Sep", or with its year, of the day `days` after an ISO date. */
export function dayAfter(date: string, days: number, year = false): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

const figure = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 1 });

function Periods({ forecast, city }: { forecast: Forecast; city: string }) {
  const { run } = forecast;
  if (run === null) return <p className={form.note}>{copy.none}</p>;
  if (forecast.lines.length === 0) return <p className={form.note}>{copy.empty(city)}</p>;
  const items = new Map<string, { name: string; periods: Map<number, Forecast["lines"][number]> }>();
  for (const line of forecast.lines) {
    const item = items.get(line.consumable_code) ?? { name: line.name, periods: new Map() };
    item.periods.set(line.period, line);
    items.set(line.consumable_code, item);
  }
  const periods = Array.from({ length: run.horizon_periods }, (_, period) => period);
  return (
    <>
      <p className={form.note}>{copy.note(run.period_days, dayAfter(run.run_on, 0, true))}</p>
      <div className={own.scroll}>
        <Table className={`${form.table} ${own.forecast}`}>
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
                <th scope="row" className={form.rowHead}>
                  {item.name}
                </th>
                {periods.map((period) => {
                  const line = item.periods.get(period);
                  return (
                    <td key={period} className={form.figure}>
                      {figure(line?.expected ?? 0)}
                      {line !== undefined && line.high > line.expected && (
                        <span className={own.high}>{copy.high(figure(line.high))}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  );
}

export function ForecastPanel({ cities }: { cities: readonly string[] }) {
  const [city, setCity] = useState(cities[0] ?? "");
  const load = useCallback(() => client.get("/api/stock/forecast", { query: { city } }), [city]);
  const [loaded, retry] = useLoad(load);
  return (
    <section className={form.panel} aria-labelledby="plan-forecast">
      <div className={form.panelHead}>
        <h2 className={form.panelTitle} id="plan-forecast">
          {copy.title}
        </h2>
      </div>
      <Field label={copy.city} className={form.field}>
        {(control) => (
          <Select
            {...control}
            className={form.choiceBox}
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
    </section>
  );
}
