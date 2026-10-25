// How right the forecast was, beneath it on the Supply plan (docs/decisions/0183-forecast-accuracy.md): the city's last
// measured periods, and each item across them, the furthest off first.

import type { Success } from "@maneman/web-kit/api";
import { quantity } from "@maneman/web-kit/figures";
import { Note } from "@maneman/ui/Note";
import { BarChart } from "@maneman/ui/BarChart";
import { Table, TableScroll } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { useCallback } from "react";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { supplyPlan } from "../content/supply-plan.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { dayAfter } from "./Forecast.tsx";
import { RowHead } from "../components/RowHead.tsx";
import { supplyPlanApi } from "./supply-plan-api.ts";

type Accuracy = Success<paths["/api/stock/forecast-accuracy"]["get"]>;

const copy = supplyPlan.accuracy;

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
  if (accuracy.periods.length === 0) return <Note>{copy.none}</Note>;
  return (
    <>
      <BarChart
        label={copy.chart}
        bars={accuracy.periods.map((period) => ({
          key: period.period_start,
          label: dayAfter(period.period_start, 0, true),
          value: period.error_percent ?? 0,
          shown: copy.percent(period.error_percent),
        }))}
      />
      <TableScroll labelledBy="plan-forecast">
        <Table controls>
          <Head columns={copy.periodColumns} />
          <tbody>
            {accuracy.periods.map((period) => (
              <tr key={period.period_start}>
                <RowHead>{dayAfter(period.period_start, 0, true)}</RowHead>
                <td className={form.figure}>{quantity(period.expected)}</td>
                <td className={form.figure}>{quantity(period.actual)}</td>
                <td className={form.figure}>{copy.percent(period.error_percent)}</td>
                <td className={form.figure}>{copy.bias(period.bias_percent)}</td>
                <td className={form.figure}>{copy.percent(period.within_high_percent)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Table controls>
          <Head columns={copy.itemColumns} />
          <tbody>
            {accuracy.items.map((item) => (
              <tr key={item.consumable_code}>
                <RowHead>{item.name}</RowHead>
                <td className={form.figure}>{quantity(item.expected)}</td>
                <td className={form.figure}>{quantity(item.actual)}</td>
                <td className={form.figure}>{copy.percent(item.error_percent)}</td>
                <td className={form.figure}>{copy.bias(item.bias_percent)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </>
  );
}

export function AccuracyPart({ city }: { city: string }) {
  const load = useCallback(() => supplyPlanApi.accuracy({ city }), [city]);
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
