// The client's custom orders, beneath the stock their profile matches (docs/decisions/0174-custom-orders.md): each
// with its spec, price and where it stands, its payment link sent again or the order cancelled while unpaid; and a new
// one raised.

import { Button } from "@maneman/ui/Button";
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
import { RaiseCustomOrder, type CustomOrdersBook } from "./RaiseCustomOrder.tsx";

type Order = CustomOrdersBook["orders"][number];
type Answer = Awaited<ReturnType<typeof client.post<"/api/custom-orders/{id}/cancel">>>;

function Steps({ order, onAnswer }: { order: Order; onAnswer: (answer: Answer, said: string) => void }) {
  const access = useAccess();
  if (order.status !== "awaiting_payment") return null;
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

function OrdersTable({ book, onAnswer }: { book: CustomOrdersBook; onAnswer: (answer: Answer, said: string) => void }) {
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
              {copy.number(order.number)}
            </th>
            <td>{copy.spec(order)}</td>
            <td className={form.figure}>{rupees(order.amount)}</td>
            <td>
              {copy.statuses[order.status] ?? order.status}
              {order.status === "awaiting_payment" && order.short_url !== null && (
                <>
                  {" · "}
                  <a href={order.short_url} target="_blank" rel="noreferrer">
                    {copy.link}
                  </a>
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
  const [book, setBook] = useState<CustomOrdersBook | null>(null);
  const [raising, setRaising] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const access = useAccess();
  const current = book ?? (loaded.state === "loaded" ? loaded.value : null);
  const changed = (next: CustomOrdersBook, words: string) => {
    setBook(next);
    setSaid(words);
    setFailure(null);
    setRaising(false);
  };
  const answered = (answer: Answer, words: string) => {
    if (answer.ok) changed(answer.body, words);
    else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <section className={form.panel} aria-labelledby="custom-orders">
      <div className={form.panelHead}>
        <h2 className={form.panelTitle} id="custom-orders">
          {copy.title}
        </h2>
      </div>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {current !== null && <OrdersTable book={current} onAnswer={answered} />}
      {current !== null && raising && (
        <RaiseCustomOrder
          clientId={clientId}
          book={current}
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
        <p className={form.saved} role="status">
          {said}
        </p>
      )}
      {failure !== null && (
        <p className={form.error} role="alert">
          {errorText(copy.errors, failure)}
        </p>
      )}
    </section>
  );
}
