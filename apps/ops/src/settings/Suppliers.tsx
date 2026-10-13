// Settings, Suppliers (docs/decisions/0165-suppliers.md): who we buy stock from, on what terms, each retired rather
// than deleted; and beneath, what the supplier picked supplies, with their price, pack, minimum and lead time.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { RowButton } from "@maneman/ui/Button";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { client } from "../api.ts";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "../components/forms.module.css";
import { SupplierForm, type Supplier, type Suppliers as Book } from "./SupplierForm.tsx";
import { SupplierItems } from "./SupplierItems.tsx";
import { ActionCheck, sentOf } from "./SettingForm.tsx";

const copy = settings.suppliers;

const loadSuppliers = () => client.get("/api/suppliers");

/** What the form beneath the table is doing: adding one, or changing the one named. */
type Doing = { readonly kind: "add" } | { readonly kind: "change"; readonly id: string };

function Actions(props: {
  supplier: Supplier;
  onChange: () => void;
  onItems: () => void;
  onRetired: (book: Book, said: string) => void;
}) {
  const access = useAccess();
  const { supplier } = props;
  const retired = supplier.retired_at !== null;
  const [asking, setAsking] = useState(false);
  return (
    <td>
      <span>{retired ? copy.retired : copy.active}</span>{" "}
      <RowButton className={styles.inline} aria-label={copy.itemsLabel(supplier.name)} onClick={props.onItems}>
        {copy.items}
      </RowButton>
      {access.mayCall("POST /api/suppliers/{id}") && (
        <RowButton className={styles.inline} aria-label={copy.changeLabel(supplier.name)} onClick={props.onChange}>
          {copy.change}
        </RowButton>
      )}
      {access.mayCall("POST /api/suppliers/{id}/retire") && !asking && (
        <RowButton
          className={styles.inline}
          aria-label={retired ? copy.restoreLabel(supplier.name) : copy.retireLabel(supplier.name)}
          onClick={() => {
            setAsking(true);
          }}
        >
          {retired ? copy.restore : copy.retire}
        </RowButton>
      )}
      {asking && (
        <ActionCheck
          label={retired ? copy.restore : copy.retire}
          question={retired ? copy.restoreQuestion(supplier.name) : copy.retireQuestion(supplier.name)}
          send={async () =>
            sentOf(
              await client.post(retired ? "/api/suppliers/{id}/restore" : "/api/suppliers/{id}/retire", {
                path: { id: supplier.id },
              }),
              (book) => ({ book }),
            )
          }
          onDone={(sent) => {
            setAsking(false);
            props.onRetired(sent.book, retired ? copy.restoredSaid : copy.retiredSaid);
          }}
          errors={copy.errors}
          onCancel={() => {
            setAsking(false);
          }}
        />
      )}
    </td>
  );
}

function SupplierTable(props: {
  book: Book;
  onChange: (id: string) => void;
  onItems: (id: string) => void;
  onRetired: (book: Book, said: string) => void;
}) {
  const { book, onChange, onItems, onRetired } = props;
  return book.suppliers.length === 0 ? (
    <p className={styles.note}>{copy.none}</p>
  ) : (
    <Table className={styles.table}>
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
        {book.suppliers.map((supplier) => (
          <tr key={supplier.id}>
            <th scope="row" className={styles.rowHead}>
              {supplier.name}
            </th>
            <td>
              {supplier.country} · {supplier.currency}
            </td>
            <td>{copy.terms(supplier.payment_terms_days)}</td>
            <td>{copy.warranty(supplier.warranty_days)}</td>
            <Actions
              supplier={supplier}
              onChange={() => {
                onChange(supplier.id);
              }}
              onItems={() => {
                onItems(supplier.id);
              }}
              onRetired={onRetired}
            />
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function Suppliers() {
  const [loaded, retry] = useLoad(loadSuppliers);
  const [book, setBook] = useState<Book | null>(null);
  const [doing, setDoing] = useState<Doing>({ kind: "add" });
  const [picked, setPicked] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const access = useAccess();

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const current = book ?? loaded.value;
  const saved = (next: Book, words: string) => {
    setBook(next);
    setDoing({ kind: "add" });
    setSaid(words);
  };
  const changing = doing.kind === "change" ? current.suppliers.find((each) => each.id === doing.id) : undefined;
  const shown = current.suppliers.find((each) => each.id === picked) ?? null;

  return (
    <>
      <Panel titleId="suppliers" title={copy.title} className={styles.panel}>
        <SupplierTable
          book={current}
          onChange={(id) => {
            setDoing({ kind: "change", id });
            setSaid(null);
          }}
          onItems={setPicked}
          onRetired={saved}
        />
        {said !== null && (
          <InlineMessage tone="saved" className={styles.saved}>
            {said}
          </InlineMessage>
        )}
        {changing !== undefined ? (
          <SupplierForm
            key={changing.id}
            supplier={changing}
            onSaved={saved}
            onCancel={() => {
              setDoing({ kind: "add" });
            }}
          />
        ) : (
          access.mayCall("POST /api/suppliers") && (
            <SupplierForm key="new" supplier={null} onSaved={saved} onCancel={null} />
          )
        )}
      </Panel>
      {shown !== null && <SupplierItems book={current} supplier={shown} onSaved={saved} />}
    </>
  );
}
