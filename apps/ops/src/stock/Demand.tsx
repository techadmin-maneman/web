// Stock · Next four weeks (docs/decisions/0160-demand-and-opening-counts.md): what the visits booked are expected to
// use, by city, beside what each city holds, a shortfall marked; and the fits whose hair system is not in their city,
// each a link to its visit's day on the board. Nothing here blocks a booking.

import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Table, TableScroll } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { amountOf } from "@maneman/web-kit/figures";
import { type Stock } from "../api.ts";
import { stockViews } from "../content/stock-views.ts";
import form from "../components/forms.module.css";
import { Loading, PanelFailed } from "../states/States.tsx";
import shared from "./stock.module.css";
import styles from "./demand.module.css";
import { unitOf } from "./holdings.ts";
import { RowHead } from "../components/RowHead.tsx";
import { stockApi } from "./stock-api.ts";

const loadDemand = () => stockApi.demand();

export function Demand({ stock }: { stock: Stock }) {
  const [loaded, retry] = useLoad(loadDemand);
  const words = stockViews.demand;
  const named = (code: string | null) =>
    code === null ? words.noProfile : (stock.consumables.find((each) => each.code === code)?.name ?? code);
  const unit = (code: string) => unitOf(stock, code);
  return (
    <Panel titleId="stock-demand" title={words.title}>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && (
        <>
          {loaded.value.demand.length === 0 ? (
            <Note>{words.none}</Note>
          ) : (
            <TableScroll labelledBy="stock-demand">
              <Table controls>
                <thead>
                  <tr>
                    {words.columns.map((column) => (
                      <th scope="col" key={column}>
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loaded.value.demand.map((row) => (
                    <tr key={`${row.consumable_code}/${row.city ?? ""}`}>
                      <RowHead>{named(row.consumable_code)}</RowHead>
                      <td>{row.city ?? words.noCity}</td>
                      <td className={form.figure}>{amountOf(row.expected, unit(row.consumable_code))}</td>
                      <td className={form.figure}>
                        {amountOf(row.held, unit(row.consumable_code))}
                        {row.held < row.expected && (
                          <span className={shared.low}>{words.short(row.expected - row.held)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
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
