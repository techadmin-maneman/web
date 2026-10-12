// A hair system made to the client's profile, on Home as it comes to them (docs/decisions/0177-custom-orders-in-the-
// app.md): waiting on payment with the link to pay, paid, being made by the day promised, or arrived. Read by itself,
// so Home never waits on it; nothing shows where it cannot be read.

import { useLoad } from "@maneman/ui/useLoad";
import { shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { api } from "../api.ts";
import { home } from "../content.ts";
import styles from "./home.module.css";

const copy = home.customOrder;

type Order = { status: string; promised_on: string | null; amount: number; pay_url: string | null; number: number };

function Line({ order }: { order: Order }) {
  if (order.status === "awaiting_payment") {
    return (
      <>
        <p className={styles.promptLine}>{copy.awaitingPayment}</p>
        {order.pay_url !== null && (
          <a className={styles.promptLink} href={order.pay_url} target="_blank" rel="noreferrer">
            <span>{copy.pay(rupees(order.amount))}</span>
          </a>
        )}
      </>
    );
  }
  if (order.status === "paid") return <p className={styles.promptLine}>{copy.paid}</p>;
  if (order.status === "ordered") {
    return (
      <p className={styles.promptLine}>
        {copy.ordered(order.promised_on === null ? null : shortDate(order.promised_on))}
      </p>
    );
  }
  return <p className={styles.promptLine}>{copy.arrived}</p>;
}

export function CustomOrderCard() {
  const [loaded] = useLoad(api.customOrders);
  if (loaded.state !== "loaded") return null;
  return (
    <>
      {loaded.value.orders.map((order) => (
        <div className={styles.prompt} key={order.number}>
          <Line order={order} />
        </div>
      ))}
    </>
  );
}
