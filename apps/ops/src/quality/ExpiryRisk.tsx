// Value at risk on the Quality page (docs/decisions/0188-failure-rates-and-value-at-risk.md): each lot that will not
// all be used before it expires at its place's pace, valued at its landed cost, with what to do about it.

import type { Success } from "@maneman/web-kit/api";
import { plainDate } from "@maneman/web-kit/plain-date";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { roundRupees } from "@maneman/web-kit/money";
import type { paths } from "../api-schema.ts";
import form from "@maneman/ui/forms.module.css";
import { quality as copy } from "../content/quality.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { quantity } from "@maneman/web-kit/figures";
import { ListTools } from "@maneman/ui/ListTools";
import { RowHead } from "@maneman/ui/RowHead";
import { qualityApi } from "./quality-api.ts";

type Risk = Success<paths["/api/stock/expiry-risk"]["get"]>;
type Lot = Risk["lots"][number];

const loadRisk = () => qualityApi.expiryRisk();

const todo = (lot: Lot) =>
  lot.suggestion === "move" && lot.move_to !== null ? copy.moveTo(lot.move_to) : copy.suggestions[lot.suggestion];

function Lots({ risk }: { risk: Risk }) {
  if (risk.lots.length === 0) return <Note>{copy.noRisk}</Note>;
  return (
    <>
      <Note>{copy.riskTotal(roundRupees(risk.total_value))}</Note>
      <ListTools rows={risk.lots} textOf={(lot) => `${lot.place} ${lot.name} ${lot.lot_code}`} label={copy.findLot}>
        {(shown) => (
          <Table controls>
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
              {shown.map((lot) => (
                <tr key={`${lot.place_id}-${lot.lot_code}-${lot.consumable_code}`}>
                  <RowHead>{lot.place}</RowHead>
                  <td>{lot.name}</td>
                  <td>{lot.lot_code}</td>
                  <td>{plainDate(lot.expires_on)}</td>
                  <td className={form.figure}>{quantity(lot.quantity)}</td>
                  <td className={form.figure}>{roundRupees(lot.value)}</td>
                  <td>{todo(lot)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </ListTools>
    </>
  );
}

export function ExpiryRiskPanel() {
  const [loaded, retry] = useLoad(loadRisk);
  return (
    <Panel titleId="quality-risk" title={copy.risk}>
      {loaded.state === "loading" && <PanelLoading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && <Lots risk={loaded.value} />}
    </Panel>
  );
}
