// A hair system made to the client's profile, on Home as it comes to them (docs/decisions/0177-custom-orders-in-the-
// app.md): waiting on payment with the link to pay, paid, being made by the day promised, or arrived. Read by itself,
// so Home never waits on it; nothing shows where it cannot be read.

import { TextLink } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { api, type CustomOrder } from "../api.ts";
import { home } from "../content.ts";
import styles from "./home.module.css";

const copy = home.customOrder;

type Order = CustomOrder;

function Line({ order }: { order: Order }) {
  switch (order.status) {
    case "awaiting_payment":
      return (
        <>
          <p className={styles.promptLine}>{copy.awaitingPayment}</p>
          {order.pay_url !== null && (
            <TextLink tone="brass" className={styles.promptLink} href={order.pay_url} newTab>
              <span>{copy.pay(rupees(order.amount))}</span>
            </TextLink>
          )}
        </>
      );
    case "paid":
      return <p className={styles.promptLine}>{copy.paid}</p>;
    case "ordered":
      return (
        <p className={styles.promptLine}>
          {copy.ordered(order.promised_on === null ? null : shortDate(order.promised_on))}
        </p>
      );
    case "arrived":
      return <p className={styles.promptLine}>{copy.arrived}</p>;
  }
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
