// Operations · Purchasing, the supplier scorecard (docs/decisions/0172-supplier-scorecard.md): each supplier's last
// twelve months, on time in full, lead time against promised, what arrived damaged or failed its check, and claims.

import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { inCurrency } from "@maneman/web-kit/money";
import { client } from "../api.ts";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import { Loading, PanelFailed } from "../states/States.tsx";
import { RowHead } from "../components/RowHead.tsx";

const loadScores = () => client.get("/api/supplier-scorecard");

export function SupplierScores() {
  const [loaded, retry] = useLoad(loadScores);
  return (
    <Panel titleId="supplier-scores" title={copy.scorecard.title}>
      <p className={form.note}>{copy.scorecard.note}</p>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && loaded.value.suppliers.length === 0 && (
        <p className={form.note}>{copy.scorecard.none}</p>
      )}
      {loaded.state === "loaded" && loaded.value.suppliers.length > 0 && (
        <Table className={form.table}>
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
