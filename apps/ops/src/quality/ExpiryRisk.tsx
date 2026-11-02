// Value at risk on the Quality page (docs/decisions/0188-failure-rates-and-value-at-risk.md): each lot that will not
// all be used before it expires at its place's pace, valued at its landed cost, with what to do about it.

import type { Success } from "@maneman/web-kit/api";
import { plainDate } from "@maneman/web-kit/plain-date";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { FIGURE, Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { roundRupees } from "@maneman/web-kit/money";
import type { paths } from "../api-schema.ts";
import { quality as copy } from "../content/quality.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { quantity } from "@maneman/web-kit/figures";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { RowHead } from "@maneman/ui/RowHead";
import { qualityApi } from "./quality-api.ts";

type Risk = Success<paths["/api/stock/expiry-risk"]["get"]>;
type Lot = Risk["lots"][number];

const loadRisk = () => qualityApi.expiryRisk();

const todo = (lot: Lot) =>
  lot.suggestion === "move" && lot.move_to !== null ? copy.moveTo(lot.move_to) : copy.suggestions[lot.suggestion];

const [placeHead, itemHead, lotHead, expiresHead, leftHead, valueHead, todoHead] = copy.riskColumns;

const COLUMNS: readonly Column<Lot>[] = [
  { label: placeHead, sort: (lot) => lot.place, choice: (lot) => lot.place },
  { label: itemHead, sort: (lot) => lot.name, choice: (lot) => lot.name },
  { label: lotHead, sort: (lot) => lot.lot_code },
  { label: expiresHead, sort: (lot) => lot.expires_on },
  { label: leftHead, sort: (lot) => lot.quantity, figure: true },
  { label: valueHead, sort: (lot) => lot.value, figure: true },
  { label: todoHead, sort: todo, choice: todo },
];

function LotTable({ lots }: { lots: readonly Lot[] }) {
  const view = useTableView(lots, COLUMNS, { search: (lot) => `${lot.place} ${lot.name} ${lot.lot_code}` });
  return (
    <>
      <Narrowing view={view} label={copy.findLot} />
      <Table>
        <thead>
          <tr>
            <SortHeads view={view} />
          </tr>
        </thead>
        <tbody>
          {view.shown.map((lot) => (
            <tr key={`${lot.place_id}-${lot.lot_code}-${lot.consumable_code}`}>
              <RowHead>{lot.place}</RowHead>
              <td>{lot.name}</td>
              <td>{lot.lot_code}</td>
              <td>{plainDate(lot.expires_on)}</td>
              <td className={FIGURE}>{quantity(lot.quantity)}</td>
              <td className={FIGURE}>{roundRupees(lot.value)}</td>
              <td>{todo(lot)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <TableEnd view={view} />
    </>
  );
}

function Lots({ risk }: { risk: Risk }) {
  if (risk.lots.length === 0) return <EmptyState look="panel" line={copy.noRisk} />;
  return (
    <>
      <Note>{copy.riskTotal(roundRupees(risk.total_value))}</Note>
      <LotTable lots={risk.lots} />
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
