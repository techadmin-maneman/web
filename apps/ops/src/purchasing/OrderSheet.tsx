// A purchase order as it prints (docs/decisions/0166-purchase-orders.md), for ops to send to the supplier themselves:
// its number and date, us as the letterhead says, the supplier, where to deliver, each line by the supplier's own
// code with its quantity in units and packs and its price, the total, the payment terms and who approved it. It
// prints as soon as it is drawn, alone.

import { fullDate, indiaDate } from "@maneman/web-kit/dates";
import { Table } from "@maneman/ui/Table";
import { inCurrency } from "@maneman/web-kit/money";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { purchasing as copy } from "../content/purchasing.ts";
import type { Order, Orders } from "./types.ts";
import styles from "./order-sheet.module.css";

const sheet = copy.sheet;

/** Who the order is from, and where it is delivered, as the letterhead ops set says; nothing until they have. */
function FromUs({ letterhead }: { letterhead: Orders["letterhead"] }) {
  if (letterhead === null) return null;
  return (
    <>
      <p>
        {sheet.from}: {letterhead.legal_name}
        {letterhead.cin !== null && ` · ${sheet.cin(letterhead.cin)}`}
        {letterhead.gstin !== null && ` · ${sheet.gstin(letterhead.gstin)}`}
      </p>
      {letterhead.registered_office !== null && (
        <p className={styles.sheetAddress}>
          {sheet.registeredOffice}: {letterhead.registered_office}
        </p>
      )}
      <p className={styles.sheetAddress}>
        {sheet.deliverTo}: {letterhead.deliver_to}
      </p>
    </>
  );
}

/** Calls `onPrinted` once the browser's print is done; the print opens as the sheet is drawn. */
function usePrintOnce(onPrinted: () => void) {
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
}

export function OrderSheet({ orders, order, onPrinted }: { orders: Orders; order: Order; onPrinted: () => void }) {
  usePrintOnce(onPrinted);
  const supplier = orders.suppliers.find((each) => each.id === order.supplier_id);
  const consumable = (code: string) => orders.consumables.find((each) => each.code === code);
  const listed = (code: string) => supplier?.items.find((each) => each.consumable_code === code);
  return createPortal(
    <div id="order-sheet" className={styles.sheet}>
      <h1 className={styles.sheetTitle}>
        {sheet.title} {copy.number(order.number)}
      </h1>
      <p>
        {sheet.date}: {fullDate(indiaDate(order.drafted_at))}
        {order.expected_on !== null && ` · ${copy.order.expected(fullDate(order.expected_on))}`}
      </p>
      <FromUs letterhead={orders.letterhead} />
      <p>
        {sheet.supplier}: {supplier?.name ?? order.supplier_id}
      </p>
      <Table plain className={styles.sheetTable}>
        <thead>
          <tr>
            {sheet.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id}>
              <td>{listed(line.consumable_code)?.their_code ?? ""}</td>
              <td>{consumable(line.consumable_code)?.name ?? line.consumable_code}</td>
              <td>
                {sheet.quantity(
                  line.quantity,
                  consumable(line.consumable_code)?.unit ?? "",
                  listed(line.consumable_code)?.pack_size ?? null,
                )}
              </td>
              <td>{inCurrency(line.unit_price, order.currency)}</td>
              <td>{inCurrency(line.unit_price * line.quantity, order.currency)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className={styles.sheetTotal}>
        {copy.order.total}: {inCurrency(order.total, order.currency)}
      </p>
      {supplier !== undefined && <p>{sheet.payment(supplier.payment_terms_days)}</p>}
      {order.approved_by !== null && <p>{sheet.approvedBy(order.approved_by)}</p>}
    </div>,
    document.body,
  );
}
