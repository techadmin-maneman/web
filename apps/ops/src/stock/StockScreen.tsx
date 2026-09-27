// Stock (docs/decisions/0087-consumables-and-stock.md): what each technician's
// kit and the central store hold of each consumable, which is low, and the
// latest movements. The owner ruled on 27 September 2026 that stock is kept in
// our own ledger: FSM counts stock only through Zoho Inventory, which deducts
// only when an invoice is sent, so a free consultation or a credit visit would
// never deduct anything.
//
// What a place holds is the sum of its movements. A job's use comes out of the
// kit of the technician who recorded it, as his step lands; ops record the
// rest here. A place at or below its level is marked Low in words, and raises
// one alert (src/domain/stock.ts), which is why there is no Tasks group for it.

import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Stock } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { stock as copy } from "../content.ts";
import form from "../settings/settings.module.css";
import { Loading, PanelFailed } from "../states/States.tsx";
import { placeName, StockForm } from "./StockForm.tsx";
import styles from "./stock.module.css";

/** One place's figure: what it holds, marked Low at or below its level, and when it was last counted. */
function Held({ book, code, technicianId }: { book: Stock; code: string; technicianId: string | null }) {
  const holding = book.holdings.find((each) => each.consumable_code === code && each.technician_id === technicianId);
  const unit = book.consumables.find((each) => each.code === code)?.unit ?? "";
  const quantity = holding?.quantity ?? 0;
  return (
    <td className={styles.held}>
      <span className={quantity < 0 ? styles.below : undefined}>{copy.held(quantity, unit)}</span>
      {holding?.low === true && <span className={styles.low}>{copy.low}</span>}
      {holding?.counted_at !== null && holding?.counted_at !== undefined && (
        <span className={styles.counted}>{copy.counted(shortDate(indiaDate(holding.counted_at)))}</span>
      )}
    </td>
  );
}

function OnHand({ book }: { book: Stock }) {
  if (book.consumables.length === 0) return <p className={form.note}>{copy.none}</p>;
  return (
    <div className={styles.scroll}>
      <Table className={form.table}>
        <thead>
          <tr>
            <th scope="col">{copy.consumable}</th>
            {book.places.map((place) => (
              <th scope="col" key={place.technician_id ?? "central"}>
                {placeName(book, place.technician_id)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {book.consumables.map((consumable) => (
            <tr key={consumable.code}>
              <th scope="row" className={form.rowHead}>
                {consumable.name}
                {consumable.retired && <span className={styles.retired}>{copy.retired}</span>}
              </th>
              {book.places.map((place) => (
                <Held
                  key={place.technician_id ?? "central"}
                  book={book}
                  code={consumable.code}
                  technicianId={place.technician_id}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function Movements({ book }: { book: Stock }) {
  const words = copy.movements;
  return (
    <section className={form.panel} aria-labelledby="stock-movements">
      <div className={form.panelHead}>
        <h2 className={form.panelTitle} id="stock-movements">
          {words.title}
        </h2>
      </div>
      {book.movements.length === 0 ? (
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
              {book.movements.map((movement, index) => (
                <tr key={`${movement.at}-${String(index)}`}>
                  <td className={form.figure}>
                    {shortDate(indiaDate(movement.at))}, {indiaClock(movement.at)}
                  </td>
                  <td>
                    {book.consumables.find((each) => each.code === movement.consumable_code)?.name ??
                      movement.consumable_code}
                  </td>
                  <td>{placeName(book, movement.technician_id)}</td>
                  <td className={form.figure}>{words.change(movement.quantity)}</td>
                  <td>{words.reasons[movement.reason] ?? movement.reason}</td>
                  <td>{movement.reason === "used" ? placeName(book, movement.by) : movement.by}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </section>
  );
}

export function StockScreen() {
  const [loaded, retry] = useLoad(api.stock);
  /** The stock after a movement, so the table follows without reading it again. */
  const [book, setBook] = useState<Stock | null>(null);

  return (
    <Shell section="/stock" title={copy.title} sub={copy.sub}>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} />}
      {loaded.state === "loaded" && (
        <div className={styles.screen}>
          <section className={form.panel} aria-labelledby="stock-on-hand">
            <div className={form.panelHead}>
              <h2 className={form.panelTitle} id="stock-on-hand">
                {copy.onHand}
              </h2>
            </div>
            <p className={form.note}>{copy.lowNote}</p>
            <OnHand book={book ?? loaded.value} />
          </section>
          {(book ?? loaded.value).consumables.length > 0 && (
            <StockForm book={book ?? loaded.value} onRecorded={setBook} />
          )}
          <Movements book={book ?? loaded.value} />
        </div>
      )}
    </Shell>
  );
}
