// Operations · Purchasing, the supplier scorecard (docs/decisions/0172-supplier-scorecard.md): each supplier's last
// twelve months, on time in full, lead time against promised, what arrived damaged or failed its check, and claims.

import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { inCurrency } from "@maneman/web-kit/money";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import { Loading, PanelFailed } from "../states/States.tsx";
import { RowHead } from "../components/RowHead.tsx";
import { purchasingApi } from "./purchasing-api.ts";

const loadScores = () => purchasingApi.scorecard();

export function SupplierScores() {
  const [loaded, retry] = useLoad(loadScores);
  return (
    <Panel titleId="supplier-scores" title={copy.scorecard.title}>
      <Note>{copy.scorecard.note}</Note>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && loaded.value.suppliers.length === 0 && <Note>{copy.scorecard.none}</Note>}
      {loaded.state === "loaded" && loaded.value.suppliers.length > 0 && (
        <Table controls>
          <thead>
            <tr>
              {copy.scorecard.columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loaded.value.suppliers.map((score) => (
              <tr key={score.supplier_id}>
                <RowHead>{score.name}</RowHead>
                <td className={form.figure}>{score.orders}</td>
                <td className={form.figure}>{copy.scorecard.percent(score.on_time_in_full_percent)}</td>
                <td className={form.figure}>{copy.scorecard.days(score.lead_days, score.promised_days)}</td>
                <td className={form.figure}>{copy.scorecard.percent(score.failed_check_percent)}</td>
                <td className={form.figure}>{copy.scorecard.percent(score.damaged_percent)}</td>
                <td className={form.figure}>{copy.scorecard.claims(score.claims_accepted, score.claims_settled)}</td>
                <td className={form.figure}>{score.credited > 0 ? inCurrency(score.credited, score.currency) : ""}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
