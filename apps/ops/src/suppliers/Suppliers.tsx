// Settings, Suppliers (docs/decisions/0165-suppliers.md): who we buy stock from, on what terms, each retired rather
// than deleted. A row opens its record beside the list, with what the supplier supplies, where each value changes
// where it reads (docs/decisions/0212-editing-in-place.md).

import { Toast } from "@maneman/ui/Toast";
import { PageActions } from "../components/PageHead.tsx";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { DrawerButton } from "../components/DrawerButton.tsx";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { RowHead } from "../components/RowHead.tsx";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { AddSupplier } from "./SupplierForm.tsx";
import { SupplierRecord } from "./SupplierRecord.tsx";
import { suppliersApi, type Suppliers as SupplierList } from "./suppliers-api.ts";

const copy = settings.suppliers;

const loadSuppliers = () => suppliersApi.suppliers();

function SupplierTable(props: { suppliers: SupplierList; onOpen: (id: string) => void }) {
  const { suppliers } = props;
  if (suppliers.suppliers.length === 0) return <Note>{copy.none}</Note>;
  return (
    <Table>
      <thead>
        <tr>
          {copy.columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {suppliers.suppliers.map((supplier) => (
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
            <td>{copy.terms(supplier.payment_terms_days)}</td>
            <td>{copy.warranty(supplier.warranty_days)}</td>
            <td>{supplier.retired_at === null ? copy.active : copy.retired}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function Suppliers() {
  const [loaded, retry] = useLoad(loadSuppliers);
  const [suppliers, setSuppliers] = useState<SupplierList | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const mayAdd = useAccess().mayCall("POST /api/suppliers");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const current = suppliers ?? loaded.value;
  const opened = current.suppliers.find((each) => each.id === open);

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
      <Panel titleId="suppliers" title={copy.title} padded>
        <SupplierTable
          suppliers={current}
          onOpen={(id) => {
            setOpen(id);
            setSaid(null);
          }}
        />
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
    </>
  );
}
