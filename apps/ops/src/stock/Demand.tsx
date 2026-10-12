// Stock · Next four weeks (docs/decisions/0160-demand-and-opening-counts.md): what the visits booked are expected to
// use, by city, beside what each city holds, a shortfall marked; and the fits whose hair system is not in their city,
// each a link to its visit's day on the board. Nothing here blocks a booking.

import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { client, type Stock } from "../api.ts";
import { stockViews } from "../content/stock-views.ts";
import form from "../components/forms.module.css";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./stock.module.css";

const loadDemand = () => client.get("/api/stock/demand");

export function Demand({ book }: { book: Stock }) {
  const [loaded, retry] = useLoad(loadDemand);
  const words = stockViews.demand;
  const named = (code: string | null) =>
    code === null ? words.noProfile : (book.consumables.find((each) => each.code === code)?.name ?? code);
  const unit = (code: string) => book.consumables.find((each) => each.code === code)?.unit ?? "";
  return (
    <section className={form.panel} aria-labelledby="stock-demand">
      <div className={form.panelHead}>
        <h2 className={form.panelTitle} id="stock-demand">
          {words.title}
        </h2>
      </div>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && (
        <>
          {loaded.value.demand.length === 0 ? (
            <p className={form.note}>{words.none}</p>
          ) : (
            <div className={styles.scroll}>
              <Table className={form.table}>
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
                      <th scope="row" className={form.rowHead}>
                        {named(row.consumable_code)}
                      </th>
                      <td>{row.city ?? words.noCity}</td>
                      <td className={form.figure}>{`${String(row.expected)} ${unit(row.consumable_code)}`}</td>
                      <td className={form.figure}>
                        {`${String(row.held)} ${unit(row.consumable_code)}`}
                        {row.held < row.expected && (
                          <span className={styles.low}>{words.short(row.expected - row.held)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          {loaded.value.at_risk.length > 0 && (
            <>
              <h3 className={form.panelTitle}>{words.atRisk}</h3>
              <ul className={form.note}>
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
    </section>
  );
}
