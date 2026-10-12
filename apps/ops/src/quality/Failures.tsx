// Failure rates on the Quality page (docs/decisions/0188-failure-rates-and-value-at-risk.md): the pieces fitted in the
// last year and how many failed, grouped one way at a time.

import { Field, Select } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { quality as copy } from "../content/quality.ts";
import { Loading, PanelFailed } from "../states/States.tsx";

type Rates = paths["/api/quality/failures"]["get"]["responses"][200]["content"]["application/json"];
type Way = "code" | "lot" | "supplier" | "technician";

const WAYS: readonly Way[] = ["code", "lot", "supplier", "technician"];
const loadRates = () => client.get("/api/quality/failures");

const groupsOf = (rates: Rates, way: Way) =>
  ({ code: rates.by_code, lot: rates.by_lot, supplier: rates.by_supplier, technician: rates.by_technician })[way];

function Groups({ rates }: { rates: Rates }) {
  const [way, setWay] = useState<Way>("code");
  if (rates.by_code.length === 0) return <p className={form.note}>{copy.noFailures}</p>;
  const columns = [copy.ways[way] ?? way, ...copy.failureColumns.slice(1)];
  return (
    <>
      <Field label={copy.failuresBy} className={form.field}>
        {(control) => (
          <Select
            {...control}
            className={form.choiceBox}
            value={way}
            onChange={(event) => {
              setWay(event.target.value as Way);
            }}
          >
            {WAYS.map((each) => (
              <option key={each} value={each}>
                {copy.ways[each] ?? each}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Table className={form.table}>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={column} scope="col" className={index === 0 ? undefined : form.figure}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groupsOf(rates, way).map((group) => (
            <tr key={group.name}>
              <th scope="row" className={form.rowHead}>
                {group.name}
              </th>
              <td className={form.figure}>{group.fitted}</td>
              <td className={form.figure}>{group.failed}</td>
              <td className={form.figure}>{copy.rate(group.rate_percent)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

export function FailuresPanel() {
  const [loaded, retry] = useLoad(loadRates);
  return (
    <section className={form.panel} aria-labelledby="quality-failures">
      <div className={form.panelHead}>
        <h2 className={form.panelTitle} id="quality-failures">
          {copy.failures}
        </h2>
      </div>
      <p className={form.note}>{copy.failuresNote}</p>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && <Groups rates={loaded.value} />}
    </section>
  );
}
