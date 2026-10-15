// Stock (docs/decisions/0087-consumables-and-stock.md, 0155-the-stock-place-tree.md): what each place holds of each
// item, which is low, the latest movements, and, for national managers, the places. A place holds the sum of its
// movements; a job's use comes out of its technician's kit. Low raises one alert (src/domain/inventory/stock.ts), so
// Tasks has no group for it.

import { Panel } from "@maneman/ui/Panel";
import { lazyScreen } from "@maneman/ui/lazyScreen";
import { Field, Select } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Table } from "@maneman/ui/Table";
import { fullDate, indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { Suspense, useState } from "react";
import { type Stock } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { stock as copy } from "../content/stock.ts";
import { useAccess, type OpsCall } from "../lib/access.ts";
import { recordedBy } from "../lib/who.ts";
import form from "../components/forms.module.css";
import { Loading, PanelFailed } from "../states/States.tsx";
import { Narrowing, SortHeads, TableEnd } from "../components/TableTools.tsx";
import { useTableView, type Column } from "../components/useTableView.ts";
import { KINDS, placeName, StockForm, type Kind } from "./StockForm.tsx";
import type { LabelsFor } from "./Labels.tsx";
import { holdingOf, unitOf } from "./holdings.ts";
import styles from "./stock.module.css";
import { useStock } from "./useStock.ts";
import { RowHead } from "../components/RowHead.tsx";
import { DrawerButton } from "../components/DrawerButton.tsx";
import { PageActions } from "../components/Shell.tsx";

/** The places, read only by national managers, so the panel loads only for them. */
const PlacesPanel = lazyScreen(() => import("./PlacesPanel.tsx").then((module) => module.PlacesPanel));

/** The totals by zone or city, and the lots that expire soon, each loaded when shown. */
const Totals = lazyScreen(() => import("./Totals.tsx").then((module) => module.Totals));
const Expiring = lazyScreen(() => import("./Expiring.tsx").then((module) => module.Expiring));
const Demand = lazyScreen(() => import("./Demand.tsx").then((module) => module.Demand));

/** The labels of pieces and lots, loaded for those who may print them. */
const Labels = lazyScreen(() => import("./Labels.tsx").then((module) => module.Labels));

/** Whether any lot within reach expires within the warning, so the Expiring panel is worth loading. */
function anyExpiring(stock: Stock): boolean {
  const until = new Date(Date.parse(`${stock.today}T00:00:00Z`) + stock.expiry_warning_days * 86_400_000).toISOString();
  return stock.holdings.some((holding) =>
    holding.lots.some((lot) => lot.expires_on !== null && lot.expires_on <= until.slice(0, 10)),
  );
}

/** How the table adds up the places: each its own, or by zone or city. */
function Grouping({ by, onBy }: { by: string; onBy: (by: "place" | "zone" | "city") => void }) {
  return (
    <Field label={copy.totalsBy} labelHidden>
      {(control) => (
        <Select
          {...control}
          width="choice"
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
const InTransit = lazyScreen(() => import("./InTransit.tsx").then((module) => module.InTransit));

/** The call that records each movement. A delivery goes into the warehouse, which only national staff reach. */
const RECORDING: Readonly<Record<Kind, OpsCall>> = {
  delivery: "POST /api/stock/deliveries",
  transfer: "POST /api/stock/transfers",
  count: "POST /api/stock/counts",
  write_off: "POST /api/stock/write-offs",
};

/** One place's figure: what it holds, marked Low at or below its level, and when it was last counted. */
function Held({ stock, code, place }: { stock: Stock; code: string; place: string }) {
  const holding = holdingOf(stock, code, place);
  const unit = unitOf(stock, code);
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
      {soonest !== null && <span className={styles.counted}>{copy.expires(fullDate(soonest))}</span>}
    </td>
  );
}

/** "Settings, Consumables", where each consumable and its low level is set. The sentence before it ends with it. */
function ToSettings() {
  return (
    <>
      <OpsLink className={form.link} to="/items">
        {copy.settings}
      </OpsLink>
      .
    </>
  );
}

/** Past this many places, a column each grows too wide to read: the table shows the warehouse and one place. */
const PLACES_SIDE_BY_SIDE = 6;

/** The place the table shows beside the warehouse, past a handful: each named, and marked where any is low. */
function PlacePicker({ stock, place, onPlace }: { stock: Stock; place: string; onPlace: (place: string) => void }) {
  const lowIn = (id: string) => stock.holdings.some((holding) => holding.place_id === id && holding.low);
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
          {stock.places.flatMap((each) =>
            each.kind === "warehouse"
              ? []
              : [
                  <option key={each.id} value={each.id}>
                    {placeName(stock, each.id)}
                    {lowIn(each.id) ? copy.placeLow : ""}
                  </option>,
                ],
          )}
        </Select>
      )}
    </Field>
  );
}

function OnHand({ stock }: { stock: Stock }) {
  const [picked, setPicked] = useState<string | null>(null);
  const many = stock.places.length > PLACES_SIDE_BY_SIDE;
  const beside = picked ?? stock.places.find((place) => place.kind !== "warehouse")?.id ?? "";
  const places = many
    ? stock.places.filter((place) => place.kind === "warehouse" || place.id === beside)
    : stock.places;
  if (stock.consumables.length === 0) {
    return (
      <Note>
        {copy.none} <ToSettings />
      </Note>
    );
  }
  return (
    <div className={styles.scroll}>
      {many && <PlacePicker stock={stock} place={beside} onPlace={setPicked} />}
      <Table controls>
        <thead>
          <tr>
            <th scope="col">{copy.consumable}</th>
            {places.map((place) => (
              <th scope="col" key={place.id}>
                {placeName(stock, place.id)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stock.consumables.map((consumable) => (
            <tr key={consumable.code}>
              <RowHead>
                {consumable.name}
                {consumable.retired && <span className={styles.retired}>{copy.retired}</span>}
              </RowHead>
              {places.map((place) => (
                <Held key={place.id} stock={stock} code={consumable.code} place={place.id} />
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
function Movements({ stock }: { stock: Stock }) {
  const words = copy.movements;
  const consumable = (row: Movement) =>
    stock.consumables.find((each) => each.code === row.consumable_code)?.name ?? row.consumable_code;
  const place = (row: Movement) => placeName(stock, row.place_id);
  const why = (row: Movement) => words.reasons[row.reason];
  const who = (row: Movement) => (row.reason === "used" ? placeName(stock, row.by) : recordedBy(row.by));
  const [when, what, where, change, reason, by] = words.columns;
  const columns: readonly Column<Movement>[] = [
    { label: when, sort: (row) => row.at },
    { label: what, sort: consumable, choice: consumable },
    { label: where, sort: place, choice: place },
    { label: change, sort: (row) => row.quantity },
    { label: reason, sort: why, choice: why },
    { label: by, sort: who },
  ];
  const view = useTableView(stock.movements, columns, {
    search: (row) => [consumable(row), place(row), why(row), who(row)].join(" "),
    sorted: { column: 0, direction: "descending" },
  });
  return (
    <Panel titleId="stock-movements" title={words.title}>
      {stock.movements.length === 0 ? (
        <Note>{words.none}</Note>
      ) : (
        <>
          <Narrowing view={view} label={words.narrow} />
          <div className={styles.scroll}>
            <Table controls>
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
    </Panel>
  );
}

export function StockScreen() {
  const { loaded, retry, current, setStock } = useStock();
  const [by, setBy] = useState<"place" | "zone" | "city">("place");
  /** A hair system's delivery opens its labels at the warehouse, afresh each time. */
  const [labelsFor, setLabelsFor] = useState<{ readonly at: LabelsFor; readonly time: number } | null>(null);
  const access = useAccess();
  const [firstKind, ...otherKinds] = KINDS.filter((kind) => access.mayCall(RECORDING[kind]));

  return (
    <>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {current !== null && (
        <div className={styles.screen}>
          <Panel titleId="stock-on-hand" title={copy.onHand} actions={<Grouping by={by} onBy={setBy} />}>
            {by === "place" ? (
              <OnHand stock={current} />
            ) : (
              <Suspense fallback={<Loading />}>
                <Totals stock={current} by={by} />
              </Suspense>
            )}
          </Panel>
          {anyExpiring(current) && (
            <Suspense fallback={<Loading />}>
              <Expiring stock={current} />
            </Suspense>
          )}
          {firstKind !== undefined && current.consumables.length > 0 && (
            <PageActions>
              <DrawerButton primary label={copy.record.title}>
                {() => (
                  <StockForm
                    stock={current}
                    kinds={[firstKind, ...otherKinds]}
                    onRecorded={(after, recorded) => {
                      setStock(after);
                      const hairSystem = after.consumables.some(
                        (each) => each.code === recorded.code && each.hair_system,
                      );
                      if (recorded.kind === "delivery" && hairSystem) {
                        setLabelsFor({
                          at: { code: recorded.code, place: "central" },
                          time: (labelsFor?.time ?? 0) + 1,
                        });
                      }
                    }}
                  />
                )}
              </DrawerButton>
            </PageActions>
          )}
          <Suspense fallback={<Loading />}>
            <Demand stock={current} />
          </Suspense>
          {current.in_transit.length > 0 && (
            <Suspense fallback={<Loading />}>
              <InTransit stock={current} onChanged={setStock} />
            </Suspense>
          )}
          {access.mayCall("GET /api/stock/units") && (
            <Suspense fallback={<Loading />}>
              <Labels key={String(labelsFor?.time ?? 0)} stock={current} focus={labelsFor?.at ?? null} />
            </Suspense>
          )}
          <Movements stock={current} />
          {access.mayCall("POST /api/stock/places") && (
            <Suspense fallback={<Loading />}>
              <PlacesPanel stock={current} onChanged={setStock} />
            </Suspense>
          )}
        </div>
      )}
    </>
  );
}
