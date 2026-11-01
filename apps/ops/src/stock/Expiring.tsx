// Stock · Expiring (docs/decisions/0159-stock-views-and-expiry.md): every lot within reach that expires within ops'
// warning days (`stock_watch`), or has, soonest first, with where it is and how much is there. The morning alert says the same
// in the chat; here ops act on it, moving the stock or writing it off by its lot.

import { Note } from "@maneman/ui/Note";
import { Badge } from "@maneman/ui/Badge";
import { Panel } from "@maneman/ui/Panel";
import { FIGURE, Table, TableScroll } from "@maneman/ui/Table";
import { listDate } from "@maneman/web-kit/dates";
import type { Stock } from "../api.ts";
import { stockViews } from "../content/stock-views.ts";
import { placeName } from "./StockForm.tsx";
import styles from "./stock.module.css";
import { RowHead } from "@maneman/ui/RowHead";

/** The lots that expire by the warning's end, soonest first, each where it is held. */
export function expiringLots(stock: Stock) {
  const until = new Date(Date.parse(`${stock.today}T00:00:00Z`) + stock.expiry_warning_days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return stock.holdings
    .flatMap((holding) =>
      holding.lots.map((lot) => ({ ...lot, code: holding.consumable_code, place: holding.place_id })),
    )
    .filter((lot) => lot.expires_on !== null && lot.expires_on <= until)
    .sort((a, b) => (a.expires_on ?? "").localeCompare(b.expires_on ?? ""));
}

export function Expiring({ stock }: { stock: Stock }) {
  const words = stockViews.expiring;
  return (
    <Panel titleId="stock-expiring" title={words.title}>
      <Note>{words.within(stock.expiry_warning_days)}</Note>
      <TableScroll labelledBy="stock-expiring">
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
            {expiringLots(stock).map((lot) => {
              const consumable = stock.consumables.find((each) => each.code === lot.code);
              const expired = (lot.expires_on ?? "") < stock.today;
              return (
                <tr key={`${lot.id}/${lot.place}`}>
                  <RowHead>{consumable?.name ?? lot.code}</RowHead>
                  <td>{lot.lot_code}</td>
                  <td>{placeName(stock, lot.place)}</td>
                  <td className={FIGURE}>
                    {lot.quantity} {consumable?.unit ?? ""}
                  </td>
                  <td>
                    {listDate(lot.expires_on ?? stock.today, Number(stock.today.slice(0, 4)))}
                    {expired && (
                      <Badge tone="error" className={styles.state}>
                        {words.expired}
                      </Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableScroll>
    </Panel>
  );
}
