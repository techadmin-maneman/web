// Stock · totals by zone or city (docs/decisions/0159-stock-views-and-expiry.md): what every place within reach holds
// of each consumable, added up for all of them and for each zone or city, a kit counted in its technician's city.

import { Table } from "@maneman/ui/Table";
import type { Stock } from "../api.ts";
import { stock as copy } from "../content/stock.ts";
import { stockViews } from "../content/stock-views.ts";
import form from "../components/forms.module.css";
import styles from "./stock.module.css";

export type Grouping = "zone" | "city";

/** Each group's name, by the place it is of: its zone or city, or none. */
function groupOf(place: Stock["places"][number], by: Grouping): string {
  const words = stockViews.totals;
  if (by === "zone") return place.zone ?? words.noZone;
  return place.city ?? words.noCity;
}

export function Totals({ stock, by }: { stock: Stock; by: Grouping }) {
  const groups = [...new Set(stock.places.map((place) => groupOf(place, by)))].sort();
  const sum = (code: string, group: string | null) =>
    stock.holdings
      .filter((holding) => holding.consumable_code === code)
      .filter((holding) => {
        const place = stock.places.find((each) => each.id === holding.place_id);
        return place !== undefined && (group === null || groupOf(place, by) === group);
      })
      .reduce((total, holding) => total + holding.quantity, 0);
  return (
    <div className={styles.scroll}>
      <Table className={form.table}>
        <thead>
          <tr>
            <th scope="col">{copy.consumable}</th>
            <th scope="col">{stockViews.totals.national}</th>
            {groups.map((group) => (
              <th scope="col" key={group}>
                {group}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stock.consumables.map((consumable) => (
            <tr key={consumable.code}>
              <th scope="row" className={form.rowHead}>
                {consumable.name}
              </th>
              <td className={styles.held}>{copy.held(sum(consumable.code, null), consumable.unit)}</td>
              {groups.map((group) => (
                <td className={styles.held} key={group}>
                  {copy.held(sum(consumable.code, group), consumable.unit)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
