// One purchase order beneath the list (docs/decisions/0166-purchase-orders.md): its lines and total, and what can be
// done with it now: approved, by a second manager where it needs one; marked sent; cancelled with why; printed.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { inCurrency } from "@maneman/web-kit/money";
import { useState } from "react";
import { client } from "../api.ts";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import { useLoad } from "@maneman/ui/useLoad";
import { useAccess, whoami } from "../lib/access.ts";
import { OrderSheet } from "./OrderSheet.tsx";
import { Receiving } from "./Receiving.tsx";
import type { Order, Orders } from "./types.ts";

type Answer = Awaited<ReturnType<typeof client.post<"/api/purchase-orders/{id}/send">>>;

/** Whether the person signed in may approve the order now: not where they gave its first approval already. */
function useApprovable(order: Order): boolean {
  const access = useAccess();
  const [signedIn] = useLoad(whoami);
  const me = signedIn.state === "loaded" ? signedIn.value.signed_in_as.toLowerCase() : null;
  const approvedByMe = order.approved_by !== null && order.approved_by.toLowerCase() === me;
  return order.state === "drafted" && !approvedByMe && access.mayCall("POST /api/purchase-orders/{id}/approve");
}

/** The steps the order can take now, and who may take them. */
function Steps({ order, onAnswer }: { order: Order; onAnswer: (answer: Answer, said: string) => void }) {
  const access = useAccess();
  const approvable = useApprovable(order);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const path = { path: { id: order.id } };
  const step = async (to: "approve" | "send", said: string) => {
    onAnswer(await client.post(`/api/purchase-orders/{id}/${to}`, path), said);
  };
  const cancellable =
    ["drafted", "approved", "sent"].includes(order.state) && access.mayCall("POST /api/purchase-orders/{id}/cancel");
  return (
    <>
      <div className={form.actions}>
        {approvable && (
          <Button variant="primary" size="small" onClick={() => void step("approve", copy.order.approved)}>
            {order.approved_by === null ? copy.order.approve : copy.order.secondApprove}
          </Button>
        )}
        {order.state === "approved" && access.mayCall("POST /api/purchase-orders/{id}/send") && (
          <Button variant="primary" size="small" onClick={() => void step("send", copy.order.sent)}>
            {copy.order.send}
          </Button>
        )}
        {cancellable && !cancelling && (
          <Button
            variant="outline"
            size="small"
            onClick={() => {
              setCancelling(true);
            }}
          >
            {copy.order.cancel}
          </Button>
        )}
      </div>
      {cancelling && (
        <div className={form.group}>
          <Field label={copy.order.reason} className={form.field}>
            {(control) => (
              <TextInput
                {...control}
                maxLength={200}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
            )}
          </Field>
          <div className={form.actions}>
            <Button
              variant="destructive"
              size="small"
              disabled={reason.trim() === ""}
              onClick={() =>
                void client
                  .post("/api/purchase-orders/{id}/cancel", { ...path, body: { reason: reason.trim() } })
                  .then((answer) => {
                    onAnswer(answer, copy.order.cancelled);
                  })
              }
            >
              {copy.order.confirmCancel}
            </Button>
            <Button
              variant="outline"
              size="small"
              onClick={() => {
                setCancelling(false);
              }}
            >
              {copy.order.keep}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/** The order's lines: what, how many, at what price each, and each line's total. */
function LinesTable({ order, named }: { order: Order; named: (code: string) => string }) {
  return (
    <Table className={form.table}>
      <thead>
        <tr>
          {copy.order.lines.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {order.lines.map((line) => (
          <tr key={line.id}>
            <th scope="row" className={form.rowHead}>
              {named(line.consumable_code)}
            </th>
            <td className={form.figure}>{line.quantity}</td>
            <td className={form.figure}>{inCurrency(line.unit_price, order.currency)}</td>
            <td className={form.figure}>{inCurrency(line.unit_price * line.quantity, order.currency)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function OrderPanel({
  book,
  order,
  onChanged,
}: {
  book: Orders;
  order: Order;
  onChanged: (book: Orders, said: string) => void;
}) {
  const [printing, setPrinting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const named = (code: string) => book.consumables.find((each) => each.code === code)?.name ?? code;
  const supplier = book.suppliers.find((each) => each.id === order.supplier_id)?.name ?? order.supplier_id;
  const answered = (answer: Answer, said: string) => {
    if (answer.ok) {
      setFailure(null);
      onChanged(answer.body, said);
    } else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <Panel titleId="order-panel" title={`${copy.number(order.number)} · ${supplier}`}>
      <p className={form.note}>
        {copy.states[order.state] ?? order.state}
        {order.state === "drafted" && order.approved_by !== null && ` · ${copy.awaitingSecond}`}
        {order.expected_on !== null && ` · ${copy.order.expected(order.expected_on)}`}
        {order.cancel_reason !== null && ` · ${copy.order.cancelledWhy(order.cancel_reason)}`}
      </p>
      <LinesTable order={order} named={named} />
      <p className={form.note}>
        {copy.order.total}: {inCurrency(order.total, order.currency)}
      </p>
      <Steps order={order} onAnswer={answered} />
      <Receiving book={book} order={order} onChanged={onChanged} />
      <div className={form.actions}>
        <Button
          variant="outline"
          size="small"
          onClick={() => {
            setPrinting(true);
          }}
        >
          {copy.order.print}
        </Button>
      </div>
      {failure !== null && (
        <InlineMessage tone="error" className={form.error}>
          {errorText(copy.errors, failure)}
        </InlineMessage>
      )}
      {printing && (
        <OrderSheet
          book={book}
          order={order}
          onPrinted={() => {
            setPrinting(false);
          }}
        />
      )}
    </Panel>
  );
}
