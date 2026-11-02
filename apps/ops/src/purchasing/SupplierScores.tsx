// Operations · Purchasing, the supplier scorecard (docs/decisions/0172-supplier-scorecard.md): each supplier's last
// twelve months, on time in full, lead time against promised, what arrived damaged or failed its check, and claims.

import { EmptyState } from "@maneman/ui/EmptyState";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { FIGURE, Table } from "@maneman/ui/Table";
import { SortHeads } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import type { Success } from "@maneman/web-kit/api";
import type { paths } from "../api-schema.ts";
import { useLoad } from "@maneman/ui/useLoad";
import { inCurrency } from "@maneman/web-kit/money";
import { purchasing as copy } from "../content/purchasing.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { RowHead } from "@maneman/ui/RowHead";
import { purchasingApi } from "./purchasing-api.ts";

const loadScores = () => purchasingApi.scorecard();

type Score = Success<paths["/api/supplier-scorecard"]["get"]>["suppliers"][number];

const [supplier, orders, onTime, lead, failed, damaged, claims, credited] = copy.scorecard.columns;

/** Every column sorts, a figure each but the supplier's name. */
const COLUMNS: readonly Column<Score>[] = [
  { label: supplier, sort: (score) => score.name },
  { label: orders, sort: (score) => score.orders, figure: true },
  { label: onTime, sort: (score) => score.on_time_in_full_percent ?? -1, figure: true },
  { label: lead, sort: (score) => score.lead_days ?? -1, figure: true },
  { label: failed, sort: (score) => score.failed_check_percent ?? -1, figure: true },
  { label: damaged, sort: (score) => score.damaged_percent ?? -1, figure: true },
  { label: claims, sort: (score) => score.claims_accepted, figure: true },
  { label: credited, sort: (score) => score.credited, figure: true },
];

function ScoreTable({ scores }: { scores: readonly Score[] }) {
  const view = useTableView(scores, COLUMNS);
  return (
    <Table>
      <thead>
        <tr>
          <SortHeads view={view} />
        </tr>
      </thead>
      <tbody>
        {view.shown.map((score) => (
          <tr key={score.supplier_id}>
            <RowHead>{score.name}</RowHead>
            <td className={FIGURE}>{score.orders}</td>
            <td className={FIGURE}>{copy.scorecard.percent(score.on_time_in_full_percent)}</td>
            <td className={FIGURE}>{copy.scorecard.days(score.lead_days, score.promised_days)}</td>
            <td className={FIGURE}>{copy.scorecard.percent(score.failed_check_percent)}</td>
            <td className={FIGURE}>{copy.scorecard.percent(score.damaged_percent)}</td>
            <td className={FIGURE}>{copy.scorecard.claims(score.claims_accepted, score.claims_settled)}</td>
            <td className={FIGURE}>{score.credited > 0 ? inCurrency(score.credited, score.currency) : ""}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function SupplierScores() {
  const [loaded, retry] = useLoad(loadScores);
  return (
    <Panel titleId="supplier-scores" title={copy.scorecard.title}>
      <Note>{copy.scorecard.note}</Note>
      {loaded.state === "loading" && <PanelLoading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && loaded.value.suppliers.length === 0 && (
        <EmptyState look="panel" line={copy.scorecard.none} />
      )}
      {loaded.state === "loaded" && loaded.value.suppliers.length > 0 && <ScoreTable scores={loaded.value.suppliers} />}
    </Panel>
  );
}
