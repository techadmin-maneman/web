// Settings, Suppliers (docs/decisions/0165-suppliers.md): who we buy stock from, on what terms, each retired rather
// than deleted. A row opens its record beside the list, with what the supplier supplies, where each value changes
// where it reads (docs/decisions/0212-editing-in-place.md).

import { Toast } from "@maneman/ui/Toast";
import { Apart } from "@maneman/ui/Apart";
import { PageActions } from "../frame/PageHead.tsx";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Panel } from "@maneman/ui/Panel";
import { FIGURE, Table } from "@maneman/ui/Table";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { TextButton } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { RowHead } from "@maneman/ui/RowHead";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { AddSupplier } from "./SupplierForm.tsx";
import { SupplierRecord } from "./SupplierRecord.tsx";
import { suppliersApi, type Suppliers as SupplierList } from "./suppliers-api.ts";

const copy = settings.suppliers;

const loadSuppliers = () => suppliersApi.suppliers();

type Supplier = SupplierList["suppliers"][number];

const COLUMNS: readonly Column<Supplier>[] = [
  { label: copy.columns.supplier, sort: (row) => row.name },
  {
    label: copy.columns.country,
    sort: (row) => `${row.country} ${row.currency}`,
    choice: (row) => `${row.country} · ${row.currency}`,
  },
  { label: copy.columns.terms, sort: (row) => row.payment_terms_days, figure: true },
  { label: copy.columns.warranty, sort: (row) => row.warranty_days, figure: true },
];

function SupplierTable(props: { rows: readonly Supplier[]; onOpen: (id: string) => void }) {
  const view = useTableView(props.rows, COLUMNS, { search: (row) => row.name });
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
              <td>
                {supplier.country} · {supplier.currency}
              </td>
              <td className={FIGURE}>{copy.terms(supplier.payment_terms_days)}</td>
              <td className={FIGURE}>{copy.warranty(supplier.warranty_days)}</td>
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
          <DrawerButton primary label={copy.form.addTitle}>
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
          <SupplierTable rows={current.suppliers.filter((each) => each.retired_at === null)} onOpen={opening} />
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
          <SupplierTable rows={current.suppliers.filter((each) => each.retired_at !== null)} onOpen={opening} />
        </Apart>
      )}
    </>
  );
}
