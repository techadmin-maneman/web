// An order's receipts (docs/decisions/0167-receipts-and-landed-cost.md): each one's lines with what one cost landed;
// receiving more while the order is sent or part received; and closing it short once part received.

import { Button } from "@maneman/ui/Button";
import { rupees } from "@maneman/web-kit/money";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import { useAccess } from "../lib/access.ts";
import { ReceiveForm } from "./ReceiveForm.tsx";
import type { Order, Orders } from "./types.ts";
import { FormActions } from "../components/FormActions.tsx";
import { purchasingApi } from "./purchasing-api.ts";

function ReceiptList({ orders, order }: { orders: Orders; order: Order }) {
  const named = (lineId: string) => {
    const code = order.lines.find((line) => line.id === lineId)?.consumable_code ?? "";
    return orders.consumables.find((each) => each.code === code)?.name ?? code;
  };
  if (order.receipts.length === 0) return null;
  return (
    <div className={form.group}>
      <h3 className={form.fieldLabel}>{copy.receipts.title}</h3>
      {order.receipts.map((receipt) => (
        <div key={receipt.id}>
          <p className={form.note}>
            {copy.receipts.line(shortDate(indiaDate(receipt.received_at)), receipt.supplier_invoice)}
          </p>
          {receipt.lines.map((line) => (
            <p className={form.note} key={`${receipt.id}-${line.po_line_id}`}>
              {copy.receipts.item({
                name: named(line.po_line_id),
                received: line.received,
                damaged: line.damaged,
                failed: line.qc_failed,
                landed: rupees(line.landed_unit_paise),
              })}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Receiving({
  orders,
  order,
  onChanged,
}: {
  orders: Orders;
  order: Order;
  onChanged: (orders: Orders, said: string) => void;
}) {
  const access = useAccess();
  const [receiving, setReceiving] = useState(false);
  const receivable = order.state === "sent" || order.state === "part_received";
  const close = async () => {
    const answer = await purchasingApi.closeOrder(order.id);
    if (answer.ok) onChanged(answer.body, copy.receive.closed);
  };
  return (
    <>
      <ReceiptList orders={orders} order={order} />
      {receiving ? (
        <ReceiveForm
          orders={orders}
          order={order}
          onReceived={(next, said) => {
            setReceiving(false);
            onChanged(next, said);
          }}
          onCancel={() => {
            setReceiving(false);
          }}
        />
      ) : (
        <FormActions>
          {receivable && access.mayCall("POST /api/purchase-orders/{id}/receipts") && (
            <Button
              variant="primary"
              size="small"
              onClick={() => {
                setReceiving(true);
              }}
            >
              {copy.receive.open}
            </Button>
          )}
          {order.state === "part_received" && access.mayCall("POST /api/purchase-orders/{id}/close") && (
            <Button variant="outline" size="small" onClick={() => void close()}>
              {copy.receive.close}
            </Button>
          )}
        </FormActions>
      )}
    </>
  );
}
