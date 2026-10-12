// A purchase order as it prints (docs/decisions/0166-purchase-orders.md), for ops to send to the supplier themselves:
// its number and date, the supplier, each line with its price, and the total. It prints as soon as it is drawn, alone.

import { inCurrency } from "@maneman/web-kit/money";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { purchasing as copy } from "../content/purchasing.ts";
import type { Order, Orders } from "./types.ts";
import styles from "./purchasing.module.css";

export function OrderSheet({ book, order, onPrinted }: { book: Orders; order: Order; onPrinted: () => void }) {
  const done = useRef(onPrinted);
  const printed = useRef(false);
  useEffect(() => {
    if (printed.current) return;
    printed.current = true;
    window.addEventListener(
      "afterprint",
      () => {
        done.current();
      },
      { once: true },
    );
    window.print();
  }, []);
  const supplier = book.suppliers.find((each) => each.id === order.supplier_id);
  const named = (code: string) => book.consumables.find((each) => each.code === code)?.name ?? code;
  return createPortal(
    <div id="order-sheet" className={styles.sheet}>
      <h1 className={styles.sheetTitle}>
        {copy.sheet.title} {copy.number(order.number)}
      </h1>
      <p>
        {copy.sheet.supplier}: {supplier?.name ?? order.supplier_id}
      </p>
      <p>
        {copy.sheet.date}: {order.drafted_at.slice(0, 10)}
        {order.expected_on !== null && ` · ${copy.order.expected(order.expected_on)}`}
      </p>
      <table className={styles.sheetTable}>
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
              <td>{named(line.consumable_code)}</td>
              <td>{line.quantity}</td>
              <td>{inCurrency(line.unit_price, order.currency)}</td>
              <td>{inCurrency(line.unit_price * line.quantity, order.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.sheetTotal}>
        {copy.order.total}: {inCurrency(order.total, order.currency)}
      </p>
    </div>,
    document.body,
  );
}
