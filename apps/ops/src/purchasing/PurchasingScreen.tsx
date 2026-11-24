// Operations · Purchasing (docs/decisions/0166-purchase-orders.md): every open order and the latest settled, each
// opened beneath the list to approve, mark sent, cancel or print; a new order drafted from a supplier's list; what a
// printed order says of us (./Letterhead.tsx); the claims on suppliers, with the returned pieces to settle
// (./Claims.tsx); and each supplier's scorecard.

import { Toast } from "@maneman/ui/Toast";
import { TextButton } from "@maneman/ui/TextLink";
import { plainDate } from "@maneman/web-kit/plain-date";
import { indiaDate } from "@maneman/web-kit/dates";
import { Panel } from "@maneman/ui/Panel";
import { EmptyState } from "@maneman/ui/EmptyState";
import { FIGURE, Table } from "@maneman/ui/Table";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { Badge, type BadgeTone } from "@maneman/ui/Badge";
import { NoValue } from "@maneman/ui/NoValue";
import { useLoad } from "@maneman/ui/useLoad";
import { useRowPanel, type RowOpener } from "@maneman/ui/useRowPanel";
import { inCurrency } from "@maneman/web-kit/money";
import { useEffect, useState } from "react";
import { useTargetRow } from "@maneman/ui/target";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "@maneman/ui/forms.module.css";
import { useAccess } from "../lib/access.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { Claims } from "./Claims.tsx";
import { DraftOrder } from "./DraftOrder.tsx";
import { Letterhead } from "./Letterhead.tsx";
import { OrderPanel } from "./OrderPanel.tsx";
import { SupplierScores } from "./SupplierScores.tsx";
import type { Orders } from "./types.ts";
import { RowHead } from "@maneman/ui/RowHead";
import { purchasingApi } from "./purchasing-api.ts";
import { PageActions, useHeaderSub } from "../frame/PageHead.tsx";
import { DrawerButton } from "@maneman/ui/DrawerButton";

const loadOrders = () => purchasingApi.orders();

/** Drafted or approved is ours to move on; sent or part received is on its way; received and closed are done. */
const STATE_TONES: Readonly<Record<Orders["orders"][number]["state"], BadgeTone>> = {
  drafted: "attention",
  approved: "attention",
  sent: "neutral",
  part_received: "warning",
  received: "done",
  closed: "done",
  cancelled: "neutral",
};

type Order = Orders["orders"][number];

function OrdersTable({ orders, opener }: { orders: Orders; opener: RowOpener }) {
  const supplierOf = (id: string) => orders.suppliers.find((each) => each.id === id)?.name ?? id;
  const [order, supplier, drafted, state, total, expected] = copy.columns;
  const columns: readonly Column<Order>[] = [
    { label: order, sort: (row) => row.number },
    { label: supplier, sort: (row) => supplierOf(row.supplier_id), choice: (row) => supplierOf(row.supplier_id) },
    { label: drafted, sort: (row) => row.drafted_at },
    { label: state, sort: (row) => copy.states[row.state], choice: (row) => copy.states[row.state] },
    { label: total, sort: (row) => row.total, figure: true },
    { label: expected, sort: (row) => row.expected_on ?? "" },
  ];
  const view = useTableView(orders.orders, columns, {
    search: (row) =>
      `${copy.number(row.number)} ${supplierOf(row.supplier_id)} ${
        row.custom_order === null ? "" : copy.customFor(row.custom_order.number, row.custom_order.person_name)
      }`,
  });
  if (orders.orders.length === 0) return <EmptyState look="panel" line={copy.none} />;
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
          {view.shown.map((row) => (
            <tr key={row.id}>
              <RowHead
                meta={
                  row.custom_order === null
                    ? undefined
                    : copy.customFor(row.custom_order.number, row.custom_order.person_name)
                }
              >
                <TextButton compact aria-label={copy.open(copy.number(row.number))} {...opener(row.id)}>
                  {copy.number(row.number)}
                </TextButton>
              </RowHead>
              <td>{supplierOf(row.supplier_id)}</td>
              <td>{plainDate(indiaDate(row.drafted_at))}</td>
              <td>
                <Badge tone={STATE_TONES[row.state]}>{copy.states[row.state]}</Badge>
              </td>
              <td className={FIGURE}>{inCurrency(row.total, row.currency)}</td>
              <td>{row.expected_on === null ? <NoValue /> : plainDate(row.expected_on)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <TableEnd view={view} />
    </>
  );
}

/** The row kind an order's link names: "#order-<id>". */
const ORDER_ROW = "order-";

export function PurchasingScreen() {
  const [loaded, retry] = useLoad(loadOrders);
  const [orders, setOrders] = useState<Orders | null>(null);
  const { open, setOpen, panelId, opener } = useRowPanel();
  const [said, setSaid] = useState<string | null>(null);
  const access = useAccess();
  const current = orders ?? (loaded.state === "loaded" ? loaded.value : null);
  useHeaderSub(
    current === null ? undefined : copy.toApprove(current.orders.filter((each) => each.state === "drafted").length),
  );
  const changed = (next: Orders, words: string) => {
    setOrders(next);
    setSaid(words);
  };
  const opened = current?.orders.find((each) => each.id === open) ?? null;
  // A link to one order (a paid custom order's task, say: rowPath("/purchasing", "order", id)) opens it once loaded.
  const loadedOrders = current !== null;
  const target = useTargetRow(loadedOrders);
  useEffect(() => {
    if (!loadedOrders || !target?.startsWith(ORDER_ROW)) return;
    setOpen(target.slice(ORDER_ROW.length));
  }, [loadedOrders, target, setOpen]);
  return (
    <>
      {loaded.state === "loading" && <PanelLoading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {current !== null && (
        <div className={form.screen}>
          {access.mayCall("POST /api/purchase-orders/letterhead") && <Letterhead orders={current} onSaved={changed} />}
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
          {access.mayCall("GET /api/supplier-claims") && <Claims orders={current} />}
          {access.mayCall("GET /api/supplier-scorecard") && <SupplierScores />}
        </div>
      )}
    </>
  );
}
