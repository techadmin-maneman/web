// Stock (docs/decisions/0087-consumables-and-stock.md): what each technician's
// kit and the central store hold of each consumable, which is low, and the
// latest movements. Stock is kept in our own ledger, so a free consultation or a credit visit deducts what it used
// as any other job does.
//
// What a place holds is the sum of its movements. A job's use comes out of the
// kit of the technician who recorded it, as their step lands; ops record the
// rest here. A place at or below its level is marked Low in words, and raises
// one alert (src/domain/field/stock.ts), which is why there is no Tasks group for it.

import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Stock } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { stock as copy } from "../content.ts";
import { useAccess, type OpsCall } from "../lib/access.ts";
import { settingsPath } from "../route.ts";
import form from "../components/forms.module.css";
import { Loading, PanelFailed } from "../states/States.tsx";
import { Narrowing, SortHeads, TableEnd } from "../components/TableTools.tsx";
import { useTableView, type Column } from "../components/useTableView.ts";
import { KINDS, placeName, StockForm, type Kind } from "./StockForm.tsx";
import styles from "./stock.module.css";

/** The call that records each movement. A delivery goes into the central store, which only national staff reach. */
const RECORDING: Readonly<Record<Kind, OpsCall>> = {
  delivery: "POST /api/stock/deliveries",
  transfer: "POST /api/stock/transfers",
  count: "POST /api/stock/counts",
  write_off: "POST /api/stock/write-offs",
};

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

/** "Settings, Consumables", where each consumable and its low level is set. The sentence before it ends with it. */
function ToSettings() {
  return (
    <>
      <OpsLink className={form.link} to={settingsPath("consumables")}>
        {copy.settings}
      </OpsLink>
      .
    </>
  );
}

function OnHand({ book }: { book: Stock }) {
  if (book.consumables.length === 0) {
    return (
      <p className={form.note}>
        {copy.none} <ToSettings />
      </p>
    );
  }
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

type Movement = Stock["movements"][number];

/** The latest movements, sorted and narrowed on the page: what moved, where, why and by whom. */
function Movements({ book }: { book: Stock }) {
  const words = copy.movements;
  const consumable = (row: Movement) =>
    book.consumables.find((each) => each.code === row.consumable_code)?.name ?? row.consumable_code;
  const place = (row: Movement) => placeName(book, row.technician_id);
  const why = (row: Movement) => words.reasons[row.reason] ?? row.reason;
  const who = (row: Movement) => (row.reason === "used" ? placeName(book, row.by) : row.by);
  const [when, what, where, change, reason, by] = words.columns;
  const columns: readonly Column<Movement>[] = [
    { label: when, sort: (row) => row.at },
    { label: what, sort: consumable, choice: consumable },
    { label: where, sort: place, choice: place },
    { label: change, sort: (row) => row.quantity },
    { label: reason, sort: why, choice: why },
    { label: by, sort: who },
  ];
  const view = useTableView(book.movements, columns, {
    search: (row) => [consumable(row), place(row), why(row), who(row)].join(" "),
    sorted: { column: 0, direction: "descending" },
  });
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
        <>
          <Narrowing view={view} label={words.narrow} />
          <div className={styles.scroll}>
            <Table className={form.table}>
              <thead>
                <tr>
                  <SortHeads view={view} />
                </tr>
              </thead>
              <tbody>
                {view.shown.map((movement, index) => (
                  <tr key={`${movement.at}-${String(index)}`}>
                    <td className={form.figure}>
                      {shortDate(indiaDate(movement.at))}, {indiaClock(movement.at)}
                    </td>
                    <td>{consumable(movement)}</td>
                    <td>{place(movement)}</td>
                    <td className={form.figure}>{words.change(movement.quantity)}</td>
                    <td>{why(movement)}</td>
                    <td>{who(movement)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <TableEnd view={view} />
        </>
      )}
    </section>
  );
}

export function StockScreen() {
  const [loaded, retry] = useLoad(api.stock);
  /** The stock after a movement, so the table follows without reading it again. */
  const [book, setBook] = useState<Stock | null>(null);
  const access = useAccess();
  const [firstKind, ...otherKinds] = KINDS.filter((kind) => access.mayCall(RECORDING[kind]));

  return (
    <Shell section="/stock" title={copy.title}>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && (
        <div className={styles.screen}>
          <section className={form.panel} aria-labelledby="stock-on-hand">
            <div className={form.panelHead}>
              <h2 className={form.panelTitle} id="stock-on-hand">
                {copy.onHand}
              </h2>
            </div>
            <OnHand book={book ?? loaded.value} />
          </section>
          {firstKind !== undefined && (book ?? loaded.value).consumables.length > 0 && (
            <StockForm book={book ?? loaded.value} kinds={[firstKind, ...otherKinds]} onRecorded={setBook} />
          )}
          <Movements book={book ?? loaded.value} />
        </div>
      )}
    </Shell>
  );
}
