// Stock · Next four weeks (docs/decisions/0160-demand-and-opening-counts.md): what the visits booked are expected to
// use, by city, beside what each city holds, a shortfall marked; and the fits whose hair system is not in their city,
// each a link to its visit's day on the board. Nothing here blocks a booking.

import { EmptyState } from "@maneman/ui/EmptyState";
import { Badge } from "@maneman/ui/Badge";
import { Panel } from "@maneman/ui/Panel";
import { FIGURE, Table, TableScroll } from "@maneman/ui/Table";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView } from "@maneman/ui/useTableView";
import type { Success } from "@maneman/web-kit/api";
import type { paths } from "../api-schema.ts";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { amountOf } from "@maneman/web-kit/figures";
import { type Stock } from "../api.ts";
import { stockViews } from "../content/stock-views.ts";
import form from "@maneman/ui/forms.module.css";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import shared from "./stock.module.css";
import styles from "./demand.module.css";
import { unitOf } from "./holdings.ts";
import { RowHead } from "@maneman/ui/RowHead";
import { stockApi } from "./stock-api.ts";

const loadDemand = () => stockApi.demand();

type DemandRow = Success<paths["/api/stock/demand"]["get"]>["demand"][number];

/** What the next four weeks will use beside what each city holds, each column sorting, narrowed by city. */
function DemandTable(props: { stock: Stock; rows: readonly DemandRow[]; named: (code: string | null) => string }) {
  const { stock, named } = props;
  const words = stockViews.demand;
  const unit = (code: string) => unitOf(stock, code);
  const [item, city, expected, held] = words.columns;
  const view = useTableView(props.rows, [
    { label: item, sort: (row: DemandRow) => named(row.consumable_code) },
    { label: city, sort: (row: DemandRow) => row.city ?? "", choice: (row: DemandRow) => row.city ?? words.noCity },
    { label: expected, sort: (row: DemandRow) => row.expected, figure: true },
    { label: held, sort: (row: DemandRow) => row.held - row.expected, figure: true },
  ]);
  return (
    <>
      <Narrowing view={view} label={words.find} />
      <TableScroll labelledBy="stock-demand">
        <Table>
          <thead>
            <tr>
              <SortHeads view={view} />
            </tr>
          </thead>
          <tbody>
            {view.shown.map((row) => (
              <tr key={`${row.consumable_code}/${row.city ?? ""}`}>
                <RowHead>{named(row.consumable_code)}</RowHead>
                <td>{row.city ?? words.noCity}</td>
                <td className={FIGURE}>{amountOf(row.expected, unit(row.consumable_code))}</td>
                <td className={FIGURE}>
                  {amountOf(row.held, unit(row.consumable_code))}
                  {row.held < row.expected && (
                    <Badge tone="warning" className={shared.state}>
                      {words.short(row.expected - row.held)}
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
      <TableEnd view={view} />
    </>
  );
}

export function Demand({ stock }: { stock: Stock }) {
  const [loaded, retry] = useLoad(loadDemand);
  const words = stockViews.demand;
  const named = (code: string | null) =>
    code === null ? words.noProfile : (stock.consumables.find((each) => each.code === code)?.name ?? code);
  const unit = (code: string) => unitOf(stock, code);
  return (
    <Panel titleId="stock-demand" title={words.title}>
      {loaded.state === "loading" && <PanelLoading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && (
        <>
          {loaded.value.demand.length === 0 ? (
            <EmptyState look="panel" line={words.none} />
          ) : (
            <DemandTable stock={stock} rows={loaded.value.demand} named={named} />
          )}
          {loaded.value.at_risk.length > 0 && (
            <>
              <h3 className={form.ruleTitle}>{words.atRisk}</h3>
              <ul className={styles.atRisk}>
                {loaded.value.at_risk.map((fit) => (
                  <li key={fit.appointment_id}>
                    {words.fit(
                      shortDate(indiaDate(fit.window_start)),
                      fit.city ?? words.noCity,
                      named(fit.consumable_code),
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Panel>
  );
}
