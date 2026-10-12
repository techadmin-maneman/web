// Stock · Expiring (docs/decisions/0159-stock-views-and-expiry.md): every lot within reach that expires within
// EXPIRY_WARNING_DAYS, or has, soonest first, with where it is and how much is there. The morning alert says the same
// in the chat; here ops act on it, moving the stock or writing it off by its lot.

import { EXPIRY_WARNING_DAYS } from "@rules/policy/stock.ts";
import { Table } from "@maneman/ui/Table";
import { shortDate } from "@maneman/web-kit/dates";
import type { Stock } from "../api.ts";
import { stockViews } from "../content/stock-views.ts";
import form from "../components/forms.module.css";
import { placeName } from "./StockForm.tsx";
import styles from "./stock.module.css";

/** The lots that expire by the warning's end, soonest first, each where it is held. */
export function expiringLots(book: Stock) {
  const until = new Date(Date.parse(`${book.today}T00:00:00Z`) + EXPIRY_WARNING_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return book.holdings
    .flatMap((holding) =>
      holding.lots.map((lot) => ({ ...lot, code: holding.consumable_code, place: holding.place_id })),
    )
    .filter((lot) => lot.expires_on !== null && lot.expires_on <= until)
    .sort((a, b) => (a.expires_on ?? "").localeCompare(b.expires_on ?? ""));
}

export function Expiring({ book }: { book: Stock }) {
  const words = stockViews.expiring;
  return (
    <section className={form.panel} aria-labelledby="stock-expiring">
      <div className={form.panelHead}>
        <h2 className={form.panelTitle} id="stock-expiring">
          {words.title}
        </h2>
      </div>
      <p className={form.note}>{words.intro(EXPIRY_WARNING_DAYS)}</p>
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
            {expiringLots(book).map((lot) => {
              const consumable = book.consumables.find((each) => each.code === lot.code);
              const expired = (lot.expires_on ?? "") < book.today;
              return (
                <tr key={`${lot.id}/${lot.place}`}>
                  <th scope="row" className={form.rowHead}>
                    {consumable?.name ?? lot.code}
                  </th>
                  <td>{lot.lot_code}</td>
                  <td>{placeName(book, lot.place)}</td>
                  <td className={form.figure}>
                    {lot.quantity} {consumable?.unit ?? ""}
                  </td>
                  <td>
                    {shortDate(lot.expires_on ?? book.today)}
                    {expired && <span className={styles.low}>{words.expired}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    </section>
  );
}
