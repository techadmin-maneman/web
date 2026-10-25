// Stock (docs/decisions/0087-consumables-and-stock.md, 0155-the-stock-place-tree.md), a view at a time: what each
// place holds of each item and which is low, what expires, the latest movements, the labels and, for national managers,
// the places. A place holds the sum of its movements; a job's use comes out of its technician's kit. Low raises one
// alert (src/domain/inventory/stock.ts), so Tasks has no group for it.

import { Panel } from "@maneman/ui/Panel";
import { lazyScreen } from "@maneman/ui/lazyScreen";
import { Field, Select } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Table, TableScroll } from "@maneman/ui/Table";
import { fullDate, indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { Suspense, useState } from "react";
import { TabButton, Tabs } from "@maneman/ui/Tabs";
import { type Stock } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { shell } from "../content/shell.ts";
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
import { PageActions } from "../components/PageHead.tsx";

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

/** Past this many places, a column each grows too wide to read: the table shows the warehouse and one place. */
const PLACES_SIDE_BY_SIDE = 6;

/** What the table shows: each place, or past a handful the warehouse and one, or totals by zone or city. */
type Showing = { readonly by: "place"; readonly beside: string | null } | { readonly by: "zone" | "city" };

/** The places that may stand beside the warehouse, each marked where anything is low there or below nought. */
function besideOptions(stock: Stock): { readonly id: string; readonly label: string }[] {
  const held = (id: string) => stock.holdings.filter((holding) => holding.place_id === id);
  /** Below zero says more than low: a movement went unrecorded there. */
  const markOf = (id: string) => {
    if (held(id).some((holding) => holding.quantity < 0)) return copy.placeBelow;
    return held(id).some((holding) => holding.low) ? copy.placeLow : "";
  };
  return stock.places.flatMap((each) =>
    each.kind === "warehouse" ? [] : [{ id: each.id, label: `${placeName(stock, each.id)}${markOf(each.id)}` }],
  );
}

/** The one control over the table: how it adds up its places, and which one stands beside the warehouse. */
function Grouping({ stock, showing, onShow }: { stock: Stock; showing: Showing; onShow: (showing: Showing) => void }) {
  const many = stock.places.length > PLACES_SIDE_BY_SIDE;
  const value = showing.by === "place" ? `place:${showing.beside ?? ""}` : showing.by;
  return (
    <Field label={copy.totalsBy} labelHidden>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={many || showing.by !== "place" ? value : "place:"}
          onChange={(event) => {
            const picked = event.target.value;
            if (picked === "zone" || picked === "city") onShow({ by: picked });
            else onShow({ by: "place", beside: picked.slice("place:".length) || null });
          }}
        >
          {many ? (
            besideOptions(stock).map((each) => (
              <option key={each.id} value={`place:${each.id}`}>
                {each.label}
              </option>
            ))
          ) : (
            <option value="place:">{copy.byPlace}</option>
          )}
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

/** One place's figure: what it holds, marked Low at or below its level and Out at none, and when it was last counted. */
function Held({ stock, code, place }: { stock: Stock; code: string; place: string }) {
  const holding = holdingOf(stock, code, place);
  const unit = unitOf(stock, code);
  const quantity = holding?.quantity ?? 0;
  // The lots come soonest to expire first.
  const soonest = holding?.lots.find((lot) => lot.expires_on !== null)?.expires_on ?? null;
  return (
    <td className={styles.held}>
      <span className={quantity < 0 ? styles.below : undefined}>{copy.held(quantity, unit)}</span>
      {quantity < 0 && <span className={styles.low}>{copy.belowZero}</span>}
      {holding?.low === true && quantity >= 0 && (
        <span className={styles.low}>{quantity === 0 ? copy.out : copy.low}</span>
      )}
      {holding?.counted_at !== null && holding?.counted_at !== undefined && (
        <span className={styles.counted}>{copy.counted(shortDate(indiaDate(holding.counted_at)))}</span>
      )}
      {soonest !== null && <span className={styles.counted}>{copy.expires(fullDate(soonest))}</span>}
    </td>
  );
}

/** Items, where each consumable and its low level is set. The sentence before it ends with it. */
function ToItems() {
  return (
    <>
      <OpsLink className={form.link} to="/items">
        {shell.sections.items}
      </OpsLink>
      .
    </>
  );
}

function OnHand({ stock, picked }: { stock: Stock; picked: string | null }) {
  const many = stock.places.length > PLACES_SIDE_BY_SIDE;
  const beside = picked ?? stock.places.find((place) => place.kind !== "warehouse")?.id ?? "";
  const places = many
    ? stock.places.filter((place) => place.kind === "warehouse" || place.id === beside)
    : stock.places;
  if (stock.consumables.length === 0) {
    return (
      <Note>
        {copy.none} <ToItems />
      </Note>
    );
  }
  return (
    <TableScroll labelledBy="stock-on-hand">
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
    </TableScroll>
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
          <TableScroll labelledBy="stock-movements">
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
          </TableScroll>
          <TableEnd view={view} />
        </>
      )}
    </Panel>
  );
}

/** The page's views, a tab each: what is held, what expires, what moved, the labels and the places. */
type View = keyof typeof copy.views.names;

/** The views a person may open: Expiring while a lot within reach expires soon, Labels and Places by access. */
function viewsOf(stock: Stock, access: ReturnType<typeof useAccess>): readonly View[] {
  return [
    "onHand",
    ...(anyExpiring(stock) ? (["expiring"] as const) : []),
    "movements",
    ...(access.mayCall("GET /api/stock/units") ? (["labels"] as const) : []),
    ...(access.mayCall("POST /api/stock/places") ? (["places"] as const) : []),
  ];
}

/** What each place holds, by place or in totals, and what is wanted and on its way. */
function OnHandView({ stock, onChanged }: { stock: Stock; onChanged: (next: Stock) => void }) {
  const [showing, setShowing] = useState<Showing>({ by: "place", beside: null });
  return (
    <>
      <Panel
        titleId="stock-on-hand"
        title={copy.onHand}
        actions={<Grouping stock={stock} showing={showing} onShow={setShowing} />}
      >
        {showing.by === "place" ? (
          <OnHand stock={stock} picked={showing.beside} />
        ) : (
          <Suspense fallback={<Loading />}>
            <Totals stock={stock} by={showing.by} />
          </Suspense>
        )}
      </Panel>
      <Suspense fallback={<Loading />}>
        <Demand stock={stock} />
      </Suspense>
      {stock.in_transit.length > 0 && (
        <Suspense fallback={<Loading />}>
          <InTransit stock={stock} onChanged={onChanged} />
        </Suspense>
      )}
    </>
  );
}

/** Recording a movement, from the page's head: a hair system's delivery answers where its labels are. */
function RecordMovement(props: { stock: Stock; onRecorded: (after: Stock, labels: LabelsFor | null) => void }) {
  const access = useAccess();
  const [firstKind, ...otherKinds] = KINDS.filter((kind) => access.mayCall(RECORDING[kind]));
  if (firstKind === undefined || props.stock.consumables.length === 0) return null;
  return (
    <PageActions>
      <DrawerButton primary label={copy.record.title}>
        {(close) => (
          <StockForm
            stock={props.stock}
            kinds={[firstKind, ...otherKinds]}
            onRecorded={(after, recorded) => {
              const hairSystem = after.consumables.some((each) => each.code === recorded.code && each.hair_system);
              const labels =
                recorded.kind === "delivery" && hairSystem ? { code: recorded.code, place: "central" } : null;
              props.onRecorded(after, labels);
              if (labels !== null) close();
            }}
          />
        )}
      </DrawerButton>
    </PageActions>
  );
}

export function StockScreen() {
  const { loaded, retry, current, setStock } = useStock();
  const [view, setView] = useState<View>("onHand");
  /** A hair system's delivery opens its labels at the warehouse, afresh each time. */
  const [labelsFor, setLabelsFor] = useState<{ readonly at: LabelsFor; readonly time: number } | null>(null);
  const access = useAccess();
  if (current === null) {
    return loaded.state === "failed" ? <PanelFailed onRetry={retry} requestId={loaded.requestId} /> : <Loading />;
  }
  const views = viewsOf(current, access);
  const shown = views.includes(view) ? view : "onHand";
  return (
    <>
      <RecordMovement
        stock={current}
        onRecorded={(after, labels) => {
          setStock(after);
          if (labels === null) return;
          setLabelsFor({ at: labels, time: (labelsFor?.time ?? 0) + 1 });
          setView("labels");
        }}
      />
      <Tabs className={styles.views} label={copy.views.label}>
        {views.map((each) => (
          <TabButton
            key={each}
            current={each === shown}
            onClick={() => {
              setView(each);
            }}
          >
            {copy.views.names[each]}
          </TabButton>
        ))}
      </Tabs>
      <div className={styles.screen}>
        {shown === "onHand" && <OnHandView stock={current} onChanged={setStock} />}
        {shown === "movements" && <Movements stock={current} />}
        <Suspense fallback={<Loading />}>
          {shown === "expiring" && <Expiring stock={current} />}
          {shown === "labels" && (
            <Labels key={String(labelsFor?.time ?? 0)} stock={current} focus={labelsFor?.at ?? null} />
          )}
          {shown === "places" && <PlacesPanel stock={current} onChanged={setStock} />}
        </Suspense>
      </div>
    </>
  );
}
