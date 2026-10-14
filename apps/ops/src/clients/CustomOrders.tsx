// The client's custom orders, beneath the stock their profile matches (docs/decisions/0174-custom-orders.md): each
// with its spec, price and where it stands, its payment link sent again or the order cancelled while unpaid; and a new
// one raised.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { TextLink } from "@maneman/ui/TextLink";
import { Button } from "@maneman/ui/Button";
import { Field, Select } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { rupees } from "@maneman/web-kit/money";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import { client } from "../api.ts";
import form from "../components/forms.module.css";
import { customOrders as copy } from "../content/custom-orders.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { RaiseCustomOrder, type CustomOrders } from "./RaiseCustomOrder.tsx";

type Order = CustomOrders["orders"][number];
/** What a step answered: the client's whole list, or the refusal. */
type Answer =
  | { readonly ok: true; readonly body: CustomOrders }
  | { readonly ok: false; readonly code: string; readonly fields: readonly string[] };

const REFUND_REASONS = ["not_ordered", "late", "failed_check"] as const;

/** A paid order refunded in full, for the reason chosen, which the API checks holds. */
function Refund({ order, onAnswer }: { order: Order; onAnswer: (answer: Answer, said: string) => void }) {
  const access = useAccess();
  const [reason, setReason] = useState<(typeof REFUND_REASONS)[number]>(
    order.status === "paid" ? "not_ordered" : "late",
  );
  if (order.status !== "paid" && order.status !== "ordered") return null;
  if (!access.mayCall("POST /api/custom-orders/{id}/refund")) return null;
  return (
    <div className={form.actions}>
      <Field label={copy.refundWhy} className={form.field}>
        {(control) => (
          <Select
            {...control}
            value={reason}
            onChange={(event) => {
              setReason(REFUND_REASONS.find((each) => each === event.target.value) ?? "late");
            }}
          >
            {REFUND_REASONS.map((each) => (
              <option key={each} value={each}>
                {copy.reasons[each] ?? each}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button
        variant="destructive"
        size="small"
        onClick={() =>
          void client
            .post("/api/custom-orders/{id}/refund", { path: { id: order.id }, body: { reason } })
            .then((answer) => {
              onAnswer(answer, copy.refunded);
            })
        }
      >
        {copy.refund}
      </Button>
    </div>
  );
}

function Steps({ order, onAnswer }: { order: Order; onAnswer: (answer: Answer, said: string) => void }) {
  const access = useAccess();
  if (order.status !== "awaiting_payment") return <Refund order={order} onAnswer={onAnswer} />;
  const path = { path: { id: order.id } };
  return (
    <div className={form.actions}>
      {order.link_sent_at === null && access.mayCall("POST /api/custom-orders/{id}/send-link") && (
        <Button
          variant="outline"
          size="small"
          onClick={() =>
            void client.post("/api/custom-orders/{id}/send-link", path).then((answer) => {
              onAnswer(answer, copy.sent);
            })
          }
        >
          {copy.sendAgain}
        </Button>
      )}
      {access.mayCall("POST /api/custom-orders/{id}/cancel") && (
        <Button
          variant="outline"
          size="small"
          onClick={() =>
            void client.post("/api/custom-orders/{id}/cancel", path).then((answer) => {
              onAnswer(answer, copy.cancelled);
            })
          }
        >
          {copy.cancel}
        </Button>
      )}
    </div>
  );
}

function OrdersTable({
  customOrders,
  onAnswer,
}: {
  customOrders: CustomOrders;
  onAnswer: (answer: Answer, said: string) => void;
}) {
  if (customOrders.orders.length === 0) return <p className={form.note}>{copy.none}</p>;
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
        {customOrders.orders.map((order) => (
          <tr key={order.id}>
            <th scope="row" className={form.rowHead}>
              {copy.number(order.number)}
            </th>
            <td>{copy.spec(order)}</td>
            <td className={form.figure}>{rupees(order.amount)}</td>
            <td>
              {copy.statuses[order.status] ?? order.status}
              {order.status === "awaiting_payment" && order.short_url !== null && (
                <>
                  {" · "}
                  <TextLink href={order.short_url} newTab>
                    {copy.link}
                  </TextLink>
                </>
              )}
            </td>
            <td>
              <Steps order={order} onAnswer={onAnswer} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function CustomOrders({ clientId }: { clientId: string }) {
  const load = useCallback(() => client.get("/api/clients/{id}/custom-orders", { path: { id: clientId } }), [clientId]);
  const [loaded, retry] = useLoad(load);
  const [customOrders, setCustomOrders] = useState<CustomOrders | null>(null);
  const [raising, setRaising] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const access = useAccess();
  const current = customOrders ?? (loaded.state === "loaded" ? loaded.value : null);
  const changed = (next: CustomOrders, words: string) => {
    setCustomOrders(next);
    setSaid(words);
    setFailure(null);
    setRaising(false);
  };
  const answered = (answer: Answer, words: string) => {
    if (answer.ok) changed(answer.body, words);
    else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <Panel titleId="custom-orders" title={copy.title}>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {current !== null && <OrdersTable customOrders={current} onAnswer={answered} />}
      {current !== null && raising && (
        <RaiseCustomOrder
          clientId={clientId}
          customOrders={current}
          onRaised={changed}
          onClose={() => {
            setRaising(false);
          }}
        />
      )}
      {current !== null && !raising && access.mayCall("POST /api/clients/{id}/custom-orders") && (
        <div className={form.actions}>
          <Button
            variant="outline"
            size="small"
            onClick={() => {
              setRaising(true);
            }}
          >
            {copy.raise.open}
          </Button>
        </div>
      )}
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
      {failure !== null && (
        <InlineMessage tone="error" className={form.error}>
          {errorText(copy.errors, failure)}
        </InlineMessage>
      )}
    </Panel>
  );
}
