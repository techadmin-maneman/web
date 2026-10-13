// Operations · Purchasing (docs/decisions/0166-purchase-orders.md): every open order and the latest settled, each
// opened beneath the list to approve, mark sent, cancel or print; a new order drafted from a supplier's list; and the
// claims on suppliers, with the returned pieces to settle (./Claims.tsx); and each supplier's scorecard.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { RowButton } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { inCurrency } from "@maneman/web-kit/money";
import { useState } from "react";
import { client } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { Claims } from "./Claims.tsx";
import { DraftOrder } from "./DraftOrder.tsx";
import { OrderPanel } from "./OrderPanel.tsx";
import { SupplierScores } from "./SupplierScores.tsx";
import type { Orders } from "./types.ts";

const loadOrders = () => client.get("/api/purchase-orders");

function OrdersTable({ book, onOpen }: { book: Orders; onOpen: (id: string) => void }) {
  const supplierOf = (id: string) => book.suppliers.find((each) => each.id === id)?.name ?? id;
  if (book.orders.length === 0) return <p className={form.note}>{copy.none}</p>;
  return (
    <Table className={form.table}>
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
        {book.orders.map((order) => (
          <tr key={order.id}>
            <th scope="row" className={form.rowHead}>
              <RowButton
                className={form.inline}
                aria-label={copy.open(copy.number(order.number))}
                onClick={() => {
                  onOpen(order.id);
                }}
              >
                {copy.number(order.number)}
              </RowButton>
            </th>
            <td>{supplierOf(order.supplier_id)}</td>
            <td>{copy.states[order.state] ?? order.state}</td>
            <td className={form.figure}>{inCurrency(order.total, order.currency)}</td>
            <td>{order.expected_on ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function PurchasingScreen() {
  const [loaded, retry] = useLoad(loadOrders);
  const [book, setBook] = useState<Orders | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const access = useAccess();
  const current = book ?? (loaded.state === "loaded" ? loaded.value : null);
  const changed = (next: Orders, words: string) => {
    setBook(next);
    setSaid(words);
  };
  const opened = current?.orders.find((each) => each.id === open) ?? null;
  return (
    <Shell section="/purchasing" title={copy.title}>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {current !== null && (
        <div className={form.screen}>
          <Panel titleId="orders" title={copy.orders}>
            <OrdersTable book={current} onOpen={setOpen} />
            {said !== null && (
              <InlineMessage tone="saved" className={form.saved}>
                {said}
              </InlineMessage>
            )}
          </Panel>
          {opened !== null && <OrderPanel key={opened.id} book={current} order={opened} onChanged={changed} />}
          {access.mayCall("POST /api/purchase-orders") && (
            <DraftOrder
              book={current}
              onDrafted={(next, words) => {
                changed(next, words);
                setOpen(next.orders[0]?.id ?? null);
              }}
            />
          )}
          {access.mayCall("GET /api/supplier-claims") && <Claims orders={current} />}
          {access.mayCall("GET /api/supplier-scorecard") && <SupplierScores />}
        </div>
      )}
    </Shell>
  );
}
