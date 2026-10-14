// How right the forecast was, beneath it on the Supply plan (docs/decisions/0183-forecast-accuracy.md): the city's last
// measured periods, and each item across them, the furthest off first.

import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { useCallback } from "react";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { supplyPlan } from "../content/supply-plan.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { dayAfter } from "./Forecast.tsx";
import styles from "./supply-plan.module.css";

type Accuracy = paths["/api/stock/forecast-accuracy"]["get"]["responses"][200]["content"]["application/json"];

const copy = supplyPlan.accuracy;

const figure = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 1 });

function Head({ columns }: { columns: readonly string[] }) {
  return (
    <thead>
      <tr>
        {columns.map((column, index) => (
          <th key={column} scope="col" className={index === 0 ? undefined : form.figure}>
            {column}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function Measured({ accuracy }: { accuracy: Accuracy }) {
  if (accuracy.periods.length === 0) return <p className={form.note}>{copy.none}</p>;
  return (
    <>
      <p className={form.note}>{copy.note}</p>
      <div className={styles.scroll}>
        <Table className={form.table}>
          <Head columns={copy.periodColumns} />
          <tbody>
            {accuracy.periods.map((period) => (
              <tr key={period.period_start}>
                <th scope="row" className={form.rowHead}>
                  {dayAfter(period.period_start, 0, true)}
                </th>
                <td className={form.figure}>{figure(period.expected)}</td>
                <td className={form.figure}>{figure(period.actual)}</td>
                <td className={form.figure}>{copy.percent(period.error_percent)}</td>
                <td className={form.figure}>{copy.bias(period.bias_percent)}</td>
                <td className={form.figure}>{copy.percent(period.within_high_percent)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Table className={form.table}>
          <Head columns={copy.itemColumns} />
          <tbody>
            {accuracy.items.map((item) => (
              <tr key={item.consumable_code}>
                <th scope="row" className={form.rowHead}>
                  {item.name}
                </th>
                <td className={form.figure}>{figure(item.expected)}</td>
                <td className={form.figure}>{figure(item.actual)}</td>
                <td className={form.figure}>{copy.percent(item.error_percent)}</td>
                <td className={form.figure}>{copy.bias(item.bias_percent)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  );
}

export function AccuracyPart({ city }: { city: string }) {
  const load = useCallback(() => client.get("/api/stock/forecast-accuracy", { query: { city } }), [city]);
  const [loaded, retry] = useLoad(load);
  return (
    <div className={form.group}>
      <h3 className={form.ruleTitle}>{copy.title}</h3>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && <Measured accuracy={loaded.value} />}
    </div>
  );
}
