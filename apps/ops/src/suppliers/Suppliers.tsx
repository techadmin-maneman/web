// Settings, Suppliers (docs/decisions/0165-suppliers.md): who we buy stock from, on what terms, each retired rather
// than deleted. A row opens its record beside the list, with what the supplier supplies, where each value changes
// where it reads (docs/decisions/0212-editing-in-place.md).

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { Toast } from "@maneman/ui/Toast";
import { Apart } from "@maneman/ui/Apart";
import { PageActions } from "../frame/PageHead.tsx";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Panel } from "@maneman/ui/Panel";
import { FIGURE, Table } from "@maneman/ui/Table";
import { ViewRows } from "@maneman/ui/ListRow";
import { useIsPhone } from "../lib/media.ts";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { TextButton } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { useEffect, useMemo, useState } from "react";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { RowHead } from "@maneman/ui/RowHead";
import { NoValue } from "@maneman/ui/NoValue";
import { purchasingApi } from "../purchasing/index.ts";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { AddSupplier } from "./SupplierForm.tsx";
import { SupplierRecord } from "./SupplierRecord.tsx";
import { suppliersApi, type Suppliers as SupplierList } from "./suppliers-api.ts";

const copy = settings.suppliers;

const loadSuppliers = () => suppliersApi.suppliers();

type Supplier = SupplierList["suppliers"][number];

/** A country by its name, as the redesign writes it: "India" for IN; the code where the browser names none. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en-IN"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const whereOf = (row: Supplier) => copy.countryCurrency(countryName(row.country), row.currency);

/** The share of each supplier's orders that came on time and whole, by its ID, from the scorecard; null where none came. */
type OnTime = ReadonlyMap<string, number | null>;

const columnsOf = (onTime: OnTime | null): readonly Column<Supplier>[] => [
  { label: copy.columns.supplier, sort: (row) => row.name },
  { label: copy.columns.country, sort: whereOf, choice: whereOf },
  { label: copy.columns.terms, sort: (row) => row.payment_terms_days, figure: true },
  { label: copy.columns.warranty, sort: (row) => row.warranty_days, figure: true },
  ...(onTime === null
    ? []
    : [{ label: copy.columns.onTime, sort: (row: Supplier) => onTime.get(row.id) ?? -1, figure: true }]),
];

/**
 * The scorecard's on-time orders, for those whose access reads it: none for anyone else, nor while it is read or
 * where it did not come, the column then left out.
 */
function useOnTime(): OnTime | null {
  const may = useAccess().mayCall("GET /api/supplier-scorecard");
  const [onTime, setOnTime] = useState<OnTime | null>(null);
  useEffect(() => {
    if (!may) return;
    void purchasingApi.scorecard().then((answer) => {
      if (!answer.ok) return;
      setOnTime(new Map(answer.body.suppliers.map((each) => [each.supplier_id, each.on_time_in_full_percent])));
    });
  }, [may]);
  return onTime;
}

/** A supplier's on-time share, or a gap where none of its orders came over the scorecard's window. */
function OnTimeCell({ onTime, id }: { onTime: OnTime; id: string }) {
  const percent = onTime.get(id);
  return <td className={FIGURE}>{percent === undefined || percent === null ? <NoValue /> : copy.onTime(percent)}</td>;
}

/** A supplier's line on a phone: where it is, its warranty, and its on-time share where the scorecard has one. */
function metaOf(supplier: Supplier, onTime: OnTime | null): string {
  const percent = onTime?.get(supplier.id);
  const parts = [whereOf(supplier), copy.warranty(supplier.warranty_days)];
  return [...parts, ...(percent === undefined || percent === null ? [] : [copy.onTimeMeta(percent)])].join(" · ");
}

function SupplierTable(props: { rows: readonly Supplier[]; onTime: OnTime | null; onOpen: (id: string) => void }) {
  const columns = useMemo(() => columnsOf(props.onTime), [props.onTime]);
  const view = useTableView(props.rows, columns, { search: (row) => row.name });
  const phone = useIsPhone();
  if (phone) {
    return (
      <>
        <Narrowing view={view} label={copy.find} />
        <ViewRows
          rows={view.shown}
          label={copy.title}
          row={(supplier) => ({
            key: supplier.id,
            title: supplier.name,
            meta: metaOf(supplier, props.onTime),
            end: copy.terms(supplier.payment_terms_days),
            label: copy.open(supplier.name),
            onClick: () => {
              props.onOpen(supplier.id);
            },
          })}
        />
        <TableEnd view={view} />
      </>
    );
  }
  return (
    <>
      <Narrowing view={view} label={copy.find} />
      <Table>
        <thead>
          <tr>
            <SortHeads view={view} />
          </tr>
        </thead>
        <tbody>
          {view.shown.map((supplier) => (
            <tr key={supplier.id}>
              <RowHead>
                <TextButton
                  compact
                  aria-label={copy.open(supplier.name)}
                  onClick={() => {
                    props.onOpen(supplier.id);
                  }}
                >
                  {supplier.name}
                </TextButton>
              </RowHead>
              <td>{whereOf(supplier)}</td>
              <td className={FIGURE}>{copy.terms(supplier.payment_terms_days)}</td>
              <td className={FIGURE}>{copy.warranty(supplier.warranty_days)}</td>
              {props.onTime !== null && <OnTimeCell onTime={props.onTime} id={supplier.id} />}
            </tr>
          ))}
        </tbody>
      </Table>
      <TableEnd view={view} />
    </>
  );
}

export function Suppliers() {
  const [loaded, retry] = useLoad(loadSuppliers);
  const onTime = useOnTime();
  const [suppliers, setSuppliers] = useState<SupplierList | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const mayAdd = useAccess().mayCall("POST /api/suppliers");

  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const current = suppliers ?? loaded.value;
  const opened = current.suppliers.find((each) => each.id === open);
  const opening = (id: string) => {
    setOpen(id);
    setSaid(null);
  };

  return (
    <>
      <PageActions>
        {mayAdd && (
          <DrawerButton icon={ACTION_ICONS.plus} primary label={copy.form.addTitle}>
            {(close) => (
              <AddSupplier
                onAdded={(next) => {
                  setSuppliers(next);
                  setSaid(copy.added);
                  close();
                }}
                onCancel={close}
              />
            )}
          </DrawerButton>
        )}
      </PageActions>
      <Panel titleId="suppliers" title={copy.title}>
        {current.suppliers.length === 0 && <EmptyState look="panel" line={copy.none} />}
        {current.suppliers.some((each) => each.retired_at === null) && (
          <SupplierTable
            rows={current.suppliers.filter((each) => each.retired_at === null)}
            onTime={onTime}
            onOpen={opening}
          />
        )}
        {said !== null && <Toast>{said}</Toast>}
        {opened !== undefined && (
          <FormDrawer
            title={opened.name}
            onClose={() => {
              setOpen(null);
            }}
          >
            <SupplierRecord supplier={opened} suppliers={current} onSaved={setSuppliers} />
          </FormDrawer>
        )}
      </Panel>
      {current.suppliers.some((each) => each.retired_at !== null) && (
        <Apart
          id="suppliers-retired"
          title={copy.retiredTitle}
          count={current.suppliers.filter((each) => each.retired_at !== null).length}
        >
          <SupplierTable
            rows={current.suppliers.filter((each) => each.retired_at !== null)}
            onTime={onTime}
            onOpen={opening}
          />
        </Apart>
      )}
    </>
  );
}
