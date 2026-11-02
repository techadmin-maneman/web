// Operations · Usage (docs/decisions/0186-usage-and-shrinkage.md): over the last weeks, each technician's consumables
// against what their visits were expected to use, each opened to its items; and each place's losses, the flagged first.

import type { Success } from "@maneman/web-kit/api";
import { Panel } from "@maneman/ui/Panel";
import { TextButton } from "@maneman/ui/TextLink";
import { useHeaderSub } from "../frame/PageHead.tsx";
import { FIGURE, Table } from "@maneman/ui/Table";
import { ViewRows } from "@maneman/ui/ListRow";
import { useIsPhone } from "../lib/media.ts";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column, type TableView } from "@maneman/ui/useTableView";
import { EmptyState } from "@maneman/ui/EmptyState";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { useLoad } from "@maneman/ui/useLoad";
import { quantity } from "@maneman/web-kit/figures";
import { BarChart } from "@maneman/ui/BarChart";
import { roundRupees } from "@maneman/web-kit/money";
import { useState } from "react";
import type { paths } from "../api-schema.ts";
import form from "@maneman/ui/forms.module.css";
import { usage as copy } from "../content/usage.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { RowHead } from "@maneman/ui/RowHead";
import { usageApi } from "./usage-api.ts";

type Usage = Success<paths["/api/stock/usage"]["get"]>;
type Technician = Usage["technicians"][number];

const loadUsage = () => usageApi.usage();

type Item = Technician["items"][number];
type Place = Usage["places"][number];

/** A table's heads that sort, with nothing of its own beside them. */
function SortedHead<Row>({ view }: { view: TableView<Row> }) {
  return (
    <thead>
      <tr>
        <SortHeads view={view} />
      </tr>
    </thead>
  );
}

const [itemHead, itemExpected, itemUsed, itemOver] = copy.itemColumns;

function Items({ technician }: { technician: Technician }) {
  const view = useTableView(technician.items, [
    { label: itemHead, sort: (item: Item) => item.name },
    { label: itemExpected, sort: (item: Item) => item.expected, figure: true },
    { label: itemUsed, sort: (item: Item) => item.used, figure: true },
    { label: itemOver, sort: (item: Item) => item.over_percent ?? -Infinity, figure: true },
  ]);
  return (
    <Table>
      <SortedHead view={view} />
      <tbody>
        {view.shown.map((item) => (
          <tr key={item.consumable_code}>
            <RowHead>{item.name}</RowHead>
            <td className={FIGURE}>{quantity(item.expected)}</td>
            <td className={FIGURE}>{quantity(item.used)}</td>
            <td className={FIGURE}>{copy.over(item.over_percent)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Each technician's use over what their visits expected, the furthest over first. */
function OverChart({ usage }: { usage: Usage }) {
  const bars = usage.technicians
    .filter((technician) => technician.over_percent !== null)
    .sort((one, other) => (other.over_percent ?? 0) - (one.over_percent ?? 0))
    .map((technician) => ({
      key: technician.technician_id,
      label: technician.name,
      value: technician.over_percent ?? 0,
      shown: copy.over(technician.over_percent),
    }));
  return bars.length === 0 ? null : <BarChart label={copy.chart} bars={bars} />;
}

const [techHead, visitsHead, expectedHead, usedHead, overHead] = copy.technicianColumns;

const TECHNICIAN_COLUMNS: readonly Column<Technician>[] = [
  { label: techHead, sort: (row) => row.name },
  { label: visitsHead, sort: (row) => row.visits, figure: true },
  { label: expectedHead, sort: (row) => row.expected_value, figure: true },
  { label: usedHead, sort: (row) => row.used_value, figure: true },
  { label: overHead, sort: (row) => row.over_percent ?? -Infinity, figure: true },
];

function TechnicianTable({ usage, onOpen }: { usage: Usage; onOpen: (id: string) => void }) {
  const view = useTableView(usage.technicians, TECHNICIAN_COLUMNS, { search: (row) => row.name });
  const phone = useIsPhone();
  return (
    <>
      <Narrowing view={view} label={copy.find} />
      {phone ? (
        <ViewRows
          rows={view.shown}
          label={copy.technicians}
          row={(technician) => ({
            key: technician.technician_id,
            title: technician.name,
            meta: [copy.phone.visits(technician.visits), technician.flagged ? copy.flagged : null]
              .filter((part) => part !== null)
              .join(" · "),
            end: copy.over(technician.over_percent),
            endTone: technician.flagged ? "warning" : "plain",
            label: copy.items(technician.name),
            onClick: () => {
              onOpen(technician.technician_id);
            },
          })}
        />
      ) : (
        <Table>
          <SortedHead view={view} />
          <tbody>
            {view.shown.map((technician) => (
              <tr key={technician.technician_id}>
                <RowHead meta={technician.flagged ? copy.flagged : undefined}>
                  <TextButton
                    compact
                    aria-label={copy.items(technician.name)}
                    onClick={() => {
                      onOpen(technician.technician_id);
                    }}
                  >
                    {technician.name}
                  </TextButton>
                </RowHead>
                <td className={FIGURE}>{technician.visits}</td>
                <td className={FIGURE}>{roundRupees(technician.expected_value)}</td>
                <td className={FIGURE}>{roundRupees(technician.used_value)}</td>
                <td className={FIGURE}>{copy.over(technician.over_percent)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <TableEnd view={view} />
    </>
  );
}

function Technicians({ usage }: { usage: Usage }) {
  const [open, setOpen] = useState<string | null>(null);
  const opened = usage.technicians.find((technician) => technician.technician_id === open);
  return (
    <Panel titleId="usage-technicians" title={copy.technicians}>
      {usage.technicians.length === 0 ? (
        <EmptyState look="panel" line={copy.noTechnicians} />
      ) : (
        <>
          <OverChart usage={usage} />
          <TechnicianTable usage={usage} onOpen={setOpen} />
        </>
      )}
      {opened !== undefined && (
        <FormDrawer
          title={copy.items(opened.name)}
          onClose={() => {
            setOpen(null);
          }}
        >
          <Items technician={opened} />
        </FormDrawer>
      )}
    </Panel>
  );
}

const [placeHead, leftHead, lostHead, shrinkHead, writeOffsHead, countsHead] = copy.placeColumns;

const PLACE_COLUMNS: readonly Column<Place>[] = [
  { label: placeHead, sort: (row) => row.place },
  { label: leftHead, sort: (row) => row.left_value, figure: true },
  { label: lostHead, sort: (row) => row.lost_value, figure: true },
  { label: shrinkHead, sort: (row) => row.shrinkage_percent ?? -1, figure: true },
  { label: writeOffsHead, sort: (row) => row.write_offs, figure: true },
  { label: countsHead, sort: (row) => row.count_accuracy_percent ?? -1, figure: true },
];

function PlaceTable({ usage }: { usage: Usage }) {
  const view = useTableView(usage.places, PLACE_COLUMNS, { search: (row) => row.place });
  const phone = useIsPhone();
  return (
    <>
      <Narrowing view={view} label={copy.findPlace} />
      {phone ? (
        <ViewRows
          rows={view.shown}
          label={copy.places}
          row={(place) => ({
            key: place.place_id,
            title: place.place,
            meta: [copy.phone.lost(roundRupees(place.lost_value)), place.flagged ? copy.flagged : null]
              .filter((part) => part !== null)
              .join(" · "),
            end: copy.percent(place.shrinkage_percent),
            endTone: place.flagged ? "warning" : "plain",
          })}
        />
      ) : (
        <Table>
          <SortedHead view={view} />
          <tbody>
            {view.shown.map((place) => (
              <tr key={place.place_id}>
                <RowHead meta={place.flagged ? copy.flagged : undefined}>{place.place}</RowHead>
                <td className={FIGURE}>{roundRupees(place.left_value)}</td>
                <td className={FIGURE}>{roundRupees(place.lost_value)}</td>
                <td className={FIGURE}>{copy.percent(place.shrinkage_percent)}</td>
                <td className={FIGURE}>{place.write_offs}</td>
                <td className={FIGURE}>{copy.percent(place.count_accuracy_percent)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <TableEnd view={view} />
    </>
  );
}

function Places({ usage }: { usage: Usage }) {
  return (
    <Panel titleId="usage-places" title={copy.places}>
      {usage.places.length === 0 ? <EmptyState look="panel" line={copy.noPlaces} /> : <PlaceTable usage={usage} />}
    </Panel>
  );
}

export function UsageScreen() {
  const [loaded, retry] = useLoad(loadUsage);
  useHeaderSub(loaded.state === "loaded" ? copy.since(loaded.value.since) : undefined);
  return (
    <>
      {loaded.state === "loading" && <PanelLoading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && (
        <div className={form.screen}>
          <Technicians usage={loaded.value} />
          <Places usage={loaded.value} />
        </div>
      )}
    </>
  );
}
