// Stock (docs/decisions/0087-consumables-and-stock.md, 0155-the-stock-place-tree.md), a view at a time: what each
// place holds of each item and which is low, what expires, the latest movements, the labels and, for national managers,
// the places. A place holds the sum of its movements; a job's use comes out of its technician's kit. Low raises one
// alert (src/domain/inventory/stock.ts), so Tasks has no group for it.

import { Panel } from "@maneman/ui/Panel";
import { lazyScreen } from "@maneman/ui/lazyScreen";
import { EmptyState } from "@maneman/ui/EmptyState";
import { FIGURE, Table, TableScroll } from "@maneman/ui/Table";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { Suspense, useState } from "react";
import { TabButton, Tabs } from "@maneman/ui/Tabs";
import { type Stock } from "../api.ts";
import { stock as copy } from "../content/stock.ts";
import { useAccess } from "../lib/access.ts";
import { recordedBy } from "../lib/who.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { placeName } from "./StockForm.tsx";
import { RecordMovement } from "./RecordMovement.tsx";
import type { LabelsFor } from "./Labels.tsx";
import { Attention, firstShowing, Grouping, OnHand, type Showing } from "./OnHand.tsx";
import styles from "./stock.module.css";
import { useStock } from "./useStock.ts";
import { PageActions } from "../frame/PageHead.tsx";

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

/** What is on its way, which loads only while something is. */
const InTransit = lazyScreen(() => import("./InTransit.tsx").then((module) => module.InTransit));

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
        <EmptyState look="panel" line={words.none} />
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
                    <td className={FIGURE}>
                      {shortDate(indiaDate(movement.at))}, {indiaClock(movement.at)}
                    </td>
                    <td>{consumable(movement)}</td>
                    <td>{place(movement)}</td>
                    <td className={FIGURE}>{words.change(movement.quantity)}</td>
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
  const [showing, setShowing] = useState<Showing>(() => firstShowing(stock));
  return (
    <>
      <Attention stock={stock} onShow={setShowing} />
      <Panel
        titleId="stock-on-hand"
        title={copy.onHand}
        actions={<Grouping stock={stock} showing={showing} onShow={setShowing} />}
      >
        {showing.by === "place" ? (
          <OnHand stock={stock} place={showing.place} />
        ) : (
          <Suspense fallback={<PanelLoading />}>
            <Totals stock={stock} by={showing.by} />
          </Suspense>
        )}
      </Panel>
      <Suspense fallback={<PanelLoading />}>
        <Demand stock={stock} />
      </Suspense>
      {stock.in_transit.length > 0 && (
        <Suspense fallback={<PanelLoading />}>
          <InTransit stock={stock} onChanged={onChanged} />
        </Suspense>
      )}
    </>
  );
}

/** Recording a movement, from the page's head: a hair system's delivery answers where its labels are. */
function RecordFromHead(props: { stock: Stock; onRecorded: (after: Stock, labels: LabelsFor | null) => void }) {
  return (
    <PageActions>
      <RecordMovement
        stock={props.stock}
        onRecorded={(after, recorded, close) => {
          const hairSystem = after.consumables.some((each) => each.code === recorded.code && each.hair_system);
          const labels = recorded.kind === "delivery" && hairSystem ? { code: recorded.code, place: "central" } : null;
          props.onRecorded(after, labels);
          if (labels !== null) close();
        }}
      />
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
    return loaded.state === "failed" ? <PanelFailed onRetry={retry} requestId={loaded.requestId} /> : <PanelLoading />;
  }
  const views = viewsOf(current, access);
  const shown = views.includes(view) ? view : "onHand";
  return (
    <>
      <RecordFromHead
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
        <Suspense fallback={<PanelLoading />}>
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
