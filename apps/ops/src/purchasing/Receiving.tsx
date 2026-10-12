// An order's receipts (docs/decisions/0167-receipts-and-landed-cost.md): each one's lines with what one cost landed;
// receiving more while the order is sent or part received; and closing it short once part received.

import { Button } from "@maneman/ui/Button";
import { rupees } from "@maneman/web-kit/money";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { client } from "../api.ts";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import { useAccess } from "../lib/access.ts";
import { ReceiveForm } from "./ReceiveForm.tsx";
import type { Order, Orders } from "./types.ts";

function ReceiptList({ book, order }: { book: Orders; order: Order }) {
  const named = (lineId: string) => {
    const code = order.lines.find((line) => line.id === lineId)?.consumable_code ?? "";
    return book.consumables.find((each) => each.code === code)?.name ?? code;
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
  book,
  order,
  onChanged,
}: {
  book: Orders;
  order: Order;
  onChanged: (book: Orders, said: string) => void;
}) {
  const access = useAccess();
  const [receiving, setReceiving] = useState(false);
  const receivable = order.state === "sent" || order.state === "part_received";
  const close = async () => {
    const answer = await client.post("/api/purchase-orders/{id}/close", { path: { id: order.id } });
    if (answer.ok) onChanged(answer.body, copy.receive.closed);
  };
  return (
    <>
      <ReceiptList book={book} order={order} />
      {receiving ? (
        <ReceiveForm
          book={book}
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
        <div className={form.actions}>
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
        </div>
      )}
    </>
  );
}
