// Stock (docs/decisions/0087-consumables-and-stock.md, 0155-the-stock-place-tree.md): what each place holds of
// each consumable (the warehouse, hubs, stockrooms and technicians' kits), which is low, the latest movements,
// and, for national managers, the places themselves. Stock is kept in our own ledger, so a free consultation or a credit visit deducts what it used
// as any other job does.
//
// What a place holds is the sum of its movements. A job's use comes out of the
// kit of the technician who recorded it, as their step lands; ops record the
// rest here. A place at or below its level is marked Low in words, and raises
// one alert (src/domain/field/stock.ts), which is why there is no Tasks group for it.

import { EXPIRY_WARNING_DAYS } from "@rules/policy/stock.ts";
import { Field, Select } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { lazy, Suspense, useState } from "react";
import { api, type Stock } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { stock as copy } from "../content.ts";
import { useAccess, type OpsCall } from "../lib/access.ts";
import { recordedBy } from "../lib/who.ts";
import { settingsPath } from "../route.ts";
import form from "../components/forms.module.css";
import { Loading, PanelFailed } from "../states/States.tsx";
import { Narrowing, SortHeads, TableEnd } from "../components/TableTools.tsx";
import { useTableView, type Column } from "../components/useTableView.ts";
import { KINDS, placeName, StockForm, type Kind } from "./StockForm.tsx";
import type { LabelsFor } from "./Labels.tsx";
import styles from "./stock.module.css";

/** The places, read only by national managers, so the panel loads only for them. */
const PlacesPanel = lazy(() => import("./PlacesPanel.tsx").then((module) => ({ default: module.PlacesPanel })));

/** The totals by zone or city, and the lots that expire soon, each loaded when shown. */
const Totals = lazy(() => import("./Totals.tsx").then((module) => ({ default: module.Totals })));
const Expiring = lazy(() => import("./Expiring.tsx").then((module) => ({ default: module.Expiring })));
const Demand = lazy(() => import("./Demand.tsx").then((module) => ({ default: module.Demand })));

/** The labels of pieces and lots, loaded for those who may print them. */
const Labels = lazy(() => import("./Labels.tsx").then((module) => ({ default: module.Labels })));

/** Whether any lot within reach expires within the warning, so the Expiring panel is worth loading. */
function anyExpiring(book: Stock): boolean {
  const until = new Date(Date.parse(`${book.today}T00:00:00Z`) + EXPIRY_WARNING_DAYS * 86_400_000).toISOString();
  return book.holdings.some((holding) =>
    holding.lots.some((lot) => lot.expires_on !== null && lot.expires_on <= until.slice(0, 10)),
  );
}

/** How the table adds up the places: each its own, or by zone or city. */
function Grouping({ by, onBy }: { by: string; onBy: (by: "place" | "zone" | "city") => void }) {
  return (
    <Field label={copy.totalsBy} className={styles.kitPicker}>
      {(control) => (
        <Select
          {...control}
          value={by}
          onChange={(event) => {
            const picked = event.target.value;
            onBy(picked === "zone" || picked === "city" ? picked : "place");
          }}
        >
          <option value="place">{copy.byPlace}</option>
          <option value="zone">{copy.byZone}</option>
          <option value="city">{copy.byCity}</option>
        </Select>
      )}
    </Field>
  );
}

/** What is on its way, which loads only while something is. */
const InTransit = lazy(() => import("./InTransit.tsx").then((module) => ({ default: module.InTransit })));

/** The call that records each movement. A delivery goes into the warehouse, which only national staff reach. */
const RECORDING: Readonly<Record<Kind, OpsCall>> = {
  delivery: "POST /api/stock/deliveries",
  transfer: "POST /api/stock/transfers",
  count: "POST /api/stock/counts",
  write_off: "POST /api/stock/write-offs",
};

/** One place's figure: what it holds, marked Low at or below its level, and when it was last counted. */
function Held({ book, code, place }: { book: Stock; code: string; place: string }) {
  const holding = book.holdings.find((each) => each.consumable_code === code && each.place_id === place);
  const unit = book.consumables.find((each) => each.code === code)?.unit ?? "";
  const quantity = holding?.quantity ?? 0;
  // The lots come soonest to expire first.
  const soonest = holding?.lots.find((lot) => lot.expires_on !== null)?.expires_on ?? null;
  return (
    <td className={styles.held}>
      <span className={quantity < 0 ? styles.below : undefined}>{copy.held(quantity, unit)}</span>
      {holding?.low === true && <span className={styles.low}>{copy.low}</span>}
      {holding?.counted_at !== null && holding?.counted_at !== undefined && (
        <span className={styles.counted}>{copy.counted(shortDate(indiaDate(holding.counted_at)))}</span>
      )}
      {soonest !== null && <span className={styles.counted}>{copy.expires(shortDate(soonest))}</span>}
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

/** Past this many places, a column each grows too wide to read: the table shows the warehouse and one place. */
const PLACES_SIDE_BY_SIDE = 6;

/** The place the table shows beside the warehouse, past a handful: each named, and marked where any is low. */
function PlacePicker({ book, place, onPlace }: { book: Stock; place: string; onPlace: (place: string) => void }) {
  const lowIn = (id: string) => book.holdings.some((holding) => holding.place_id === id && holding.low);
  return (
    <Field label={copy.place} className={styles.kitPicker}>
      {(control) => (
        <Select
          {...control}
          value={place}
          onChange={(event) => {
            onPlace(event.target.value);
          }}
        >
          {book.places.flatMap((each) =>
            each.kind === "warehouse"
              ? []
              : [
                  <option key={each.id} value={each.id}>
                    {placeName(book, each.id)}
                    {lowIn(each.id) ? copy.placeLow : ""}
                  </option>,
                ],
          )}
        </Select>
      )}
    </Field>
  );
}

function OnHand({ book }: { book: Stock }) {
  const [picked, setPicked] = useState<string | null>(null);
  const many = book.places.length > PLACES_SIDE_BY_SIDE;
  const beside = picked ?? book.places.find((place) => place.kind !== "warehouse")?.id ?? "";
  const places = many ? book.places.filter((place) => place.kind === "warehouse" || place.id === beside) : book.places;
  if (book.consumables.length === 0) {
    return (
      <p className={form.note}>
        {copy.none} <ToSettings />
      </p>
    );
  }
  return (
    <div className={styles.scroll}>
      {many && <PlacePicker book={book} place={beside} onPlace={setPicked} />}
      <Table className={form.table}>
        <thead>
          <tr>
            <th scope="col">{copy.consumable}</th>
            {places.map((place) => (
              <th scope="col" key={place.id}>
                {placeName(book, place.id)}
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
              {places.map((place) => (
                <Held key={place.id} book={book} code={consumable.code} place={place.id} />
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
  const place = (row: Movement) => placeName(book, row.place_id);
  const why = (row: Movement) => words.reasons[row.reason] ?? row.reason;
  const who = (row: Movement) => (row.reason === "used" ? placeName(book, row.by) : recordedBy(row.by));
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
  const [by, setBy] = useState<"place" | "zone" | "city">("place");
  /** A hair system's delivery opens its labels at the warehouse, afresh each time. */
  const [labelsFor, setLabelsFor] = useState<{ readonly at: LabelsFor; readonly time: number } | null>(null);
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
            <Grouping by={by} onBy={setBy} />
            {by === "place" ? (
              <OnHand book={book ?? loaded.value} />
            ) : (
              <Suspense fallback={<Loading />}>
                <Totals book={book ?? loaded.value} by={by} />
              </Suspense>
            )}
          </section>
          {anyExpiring(book ?? loaded.value) && (
            <Suspense fallback={<Loading />}>
              <Expiring book={book ?? loaded.value} />
            </Suspense>
          )}
          {firstKind !== undefined && (book ?? loaded.value).consumables.length > 0 && (
            <StockForm
              book={book ?? loaded.value}
              kinds={[firstKind, ...otherKinds]}
              onRecorded={(after, recorded) => {
                setBook(after);
                const hairSystem = after.consumables.some((each) => each.code === recorded.code && each.hair_system);
                if (recorded.kind === "delivery" && hairSystem) {
                  setLabelsFor({ at: { code: recorded.code, place: "central" }, time: (labelsFor?.time ?? 0) + 1 });
                }
              }}
            />
          )}
          <Suspense fallback={<Loading />}>
            <Demand book={book ?? loaded.value} />
          </Suspense>
          {(book ?? loaded.value).in_transit.length > 0 && (
            <Suspense fallback={<Loading />}>
              <InTransit book={book ?? loaded.value} onChanged={setBook} />
            </Suspense>
          )}
          {access.mayCall("GET /api/stock/units") && (
            <Suspense fallback={<Loading />}>
              <Labels key={String(labelsFor?.time ?? 0)} book={book ?? loaded.value} focus={labelsFor?.at ?? null} />
            </Suspense>
          )}
          <Movements book={book ?? loaded.value} />
          {access.mayCall("POST /api/stock/places") && (
            <Suspense fallback={<Loading />}>
              <PlacesPanel book={book ?? loaded.value} onChanged={setBook} />
            </Suspense>
          )}
        </div>
      )}
    </Shell>
  );
}
