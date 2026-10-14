// Value at risk on the Quality page (docs/decisions/0188-failure-rates-and-value-at-risk.md): each lot that will not
// all be used before it expires at its place's pace, valued at its landed cost, with what to do about it.

import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { rupees } from "@maneman/web-kit/money";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { quality as copy } from "../content/quality.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { fullDate } from "@maneman/web-kit/dates";

type Risk = paths["/api/stock/expiry-risk"]["get"]["responses"][200]["content"]["application/json"];
type Lot = Risk["lots"][number];

const loadRisk = () => client.get("/api/stock/expiry-risk");

const quantity = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 1 });

const todo = (lot: Lot) =>
  lot.suggestion === "move" && lot.move_to !== null ? copy.moveTo(lot.move_to) : copy.suggestions[lot.suggestion];

function Lots({ risk }: { risk: Risk }) {
  if (risk.lots.length === 0) return <p className={form.note}>{copy.noRisk}</p>;
  return (
    <>
      <p className={form.note}>{copy.riskTotal(rupees(risk.total_value))}</p>
      <Table className={form.table}>
        <thead>
          <tr>
            {copy.riskColumns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {risk.lots.map((lot) => (
            <tr key={`${lot.place_id}-${lot.lot_code}-${lot.consumable_code}`}>
              <th scope="row" className={form.rowHead}>
                {lot.place}
              </th>
              <td>{lot.name}</td>
              <td>{lot.lot_code}</td>
              <td>{fullDate(lot.expires_on)}</td>
              <td className={form.figure}>{quantity(lot.quantity)}</td>
              <td className={form.figure}>{rupees(lot.value)}</td>
              <td>{todo(lot)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

export function ExpiryRiskPanel() {
  const [loaded, retry] = useLoad(loadRisk);
  return (
    <Panel titleId="quality-risk" title={copy.risk}>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && <Lots risk={loaded.value} />}
    </Panel>
  );
}
