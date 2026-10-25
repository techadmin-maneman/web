// Operations · Purchasing (docs/decisions/0166-purchase-orders.md): every open order and the latest settled, each
// opened beneath the list to approve, mark sent, cancel or print; a new order drafted from a supplier's list; what a
// printed order says of us (./Letterhead.tsx); the claims on suppliers, with the returned pieces to settle
// (./Claims.tsx); and each supplier's scorecard.

import { Toast } from "@maneman/ui/Toast";
import { fullDate, longDate } from "@maneman/web-kit/dates";
import { Panel } from "@maneman/ui/Panel";
import { RowButton } from "@maneman/ui/Button";
import { Note } from "@maneman/ui/Note";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { useRowPanel, type RowOpener } from "@maneman/ui/useRowPanel";
import { inCurrency } from "@maneman/web-kit/money";
import { useState } from "react";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { Claims } from "./Claims.tsx";
import { DraftOrder } from "./DraftOrder.tsx";
import { Letterhead } from "./Letterhead.tsx";
import { OrderPanel } from "./OrderPanel.tsx";
import { SupplierScores } from "./SupplierScores.tsx";
import type { Orders } from "./types.ts";
import { RowHead } from "../components/RowHead.tsx";
import { purchasingApi } from "./purchasing-api.ts";
import { PageActions } from "../components/PageHead.tsx";
import { DrawerButton } from "../components/DrawerButton.tsx";

const loadOrders = () => purchasingApi.orders();

function OrdersTable({ orders, opener }: { orders: Orders; opener: RowOpener }) {
  const supplierOf = (id: string) => orders.suppliers.find((each) => each.id === id)?.name ?? id;
  if (orders.orders.length === 0) return <Note>{copy.none}</Note>;
  return (
    <Table controls>
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
        {orders.orders.map((order) => (
          <tr key={order.id}>
            <RowHead>
              <RowButton beside aria-label={copy.open(copy.number(order.number))} {...opener(order.id)}>
                {copy.number(order.number)}
              </RowButton>
            </RowHead>
            <td>{longDate(order.drafted_at)}</td>
            <td>{supplierOf(order.supplier_id)}</td>
            <td>{copy.states[order.state]}</td>
            <td className={form.figure}>{inCurrency(order.total, order.currency)}</td>
            <td>{order.expected_on === null ? "" : fullDate(order.expected_on)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function PurchasingScreen() {
  const [loaded, retry] = useLoad(loadOrders);
  const [orders, setOrders] = useState<Orders | null>(null);
  const { open, setOpen, panelId, opener } = useRowPanel();
  const [said, setSaid] = useState<string | null>(null);
  const access = useAccess();
  const current = orders ?? (loaded.state === "loaded" ? loaded.value : null);
  const changed = (next: Orders, words: string) => {
    setOrders(next);
    setSaid(words);
  };
  const opened = current?.orders.find((each) => each.id === open) ?? null;
  return (
    <>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {current !== null && (
        <div className={form.screen}>
          <Panel titleId="orders" title={copy.orders}>
            <OrdersTable orders={current} opener={opener} />
            {said !== null && <Toast>{said}</Toast>}
          </Panel>
          {opened !== null && (
            <OrderPanel key={opened.id} id={panelId} orders={current} order={opened} onChanged={changed} />
          )}
          {access.mayCall("POST /api/purchase-orders") && (
            <PageActions>
              <DrawerButton primary label={copy.draft.title}>
                {(close) => (
                  <DraftOrder
                    orders={current}
                    onDrafted={(next, words) => {
                      changed(next, words);
                      setOpen(next.orders[0]?.id ?? null);
                      close();
                    }}
                  />
                )}
              </DrawerButton>
            </PageActions>
          )}
          {access.mayCall("POST /api/purchase-orders/letterhead") && <Letterhead orders={current} onSaved={changed} />}
          {access.mayCall("GET /api/supplier-claims") && <Claims orders={current} />}
          {access.mayCall("GET /api/supplier-scorecard") && <SupplierScores />}
        </div>
      )}
    </>
  );
}
