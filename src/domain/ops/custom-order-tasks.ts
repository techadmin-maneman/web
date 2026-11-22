// The two tasks a paid custom order puts on the board (docs/decisions/0174-custom-orders.md), so it is never left
// waiting on ops unseen: its purchase order to approve and send once the client has paid, and its piece to fit once
// it has arrived. Each is read from the order as it stands, and leaves the board as the work is done: the order sent,
// or a fit or replacement booked for the client.

import { statusIn, VISIT_LIVE } from "../../config/statuses.ts";
import type { TaskGroup } from "../../policy/tasks.ts";
import { paidNotBooked } from "../booking/hold-stages.ts";
import { MADE_TO_ORDER_QUEUE } from "../booking/made-to-order-asks.ts";

/** "CU-0042": the order's number as ops and the client read it. */
const ORDER_NUMBER = "'CU-' || printf('%04d', k.number)";
/** "PO-0042": its purchase order's. */
const PO_NUMBER = "'PO-' || printf('%04d', o.number)";
/** Where the piece is held: a place by its name, a kit by its technician's. */
const HELD_AT = "COALESCE(sp.name, t.name, u.place)";
/** The fit it is fitted at: a replacement for a client fitted before, else their first fit. */
const FIT = `CASE WHEN EXISTS (SELECT 1 FROM pieces f WHERE f.person_id = k.person_id AND f.fitted_at IS NOT NULL
    AND f.deleted_at IS NULL) THEN 'replacement' ELSE 'first_fit' END`;

/** Paid, not refunded, and its own purchase order still to go to the supplier. */
const CUSTOM_ORDER_TO_SEND: { readonly group: TaskGroup; readonly sql: string } = {
  group: "custom_order_to_send",
  sql: `SELECT 'custom_order_to_send' AS "group", k.id AS id, k.person_id AS person_id, pe.name AS person_name,
         ${ORDER_NUMBER} || ' · ' || ${PO_NUMBER} AS detail,
         json_object('order', k.number, 'purchase_order', o.number, 'purchase_order_id', o.id,
           'approved', CASE WHEN o.state = 'approved' THEN json('true') ELSE json('false') END) AS facts,
         k.paid_at AS since, NULL AS due_by, '' AS episode
    FROM custom_orders k JOIN purchase_orders o ON o.id = k.po_id JOIN people pe ON pe.id = k.person_id
   WHERE k.state = 'paid' AND k.refunded_at IS NULL AND o.state IN ('drafted', 'approved') AND pe.erased_at IS NULL`,
};

/**
 * Arrived: a piece reserved to it is held, in the warehouse or a kit, and no first fit or replacement is booked, under
 * way or paid for the client to fit it at. Read from the pieces reserved to custom orders (one for each received),
 * as Stock reads them, not from the orders. Where it is held, so ops know whether it must first go to a technician's
 * kit, and which fit to book.
 */
const CUSTOM_PIECE_TO_FIT: { readonly group: TaskGroup; readonly sql: string } = {
  group: "custom_piece_to_fit",
  sql: `SELECT 'custom_piece_to_fit' AS "group", k.id AS id, k.person_id AS person_id, pe.name AS person_name,
         ${ORDER_NUMBER} || ' · ' || ${HELD_AT} AS detail,
         json_object('order', k.number, 'piece_code', u.code, 'held_at', ${HELD_AT}, 'fit', ${FIT}) AS facts,
         u.labelled_at AS since, NULL AS due_by, '' AS episode
    FROM stock_units u INDEXED BY stock_units_reserved
    JOIN custom_orders k ON k.id = u.custom_order_id
    LEFT JOIN stock_places sp ON sp.id = u.place LEFT JOIN technicians t ON t.id = u.place
    JOIN people pe ON pe.id = k.person_id
   WHERE u.state = 'held' AND u.custom_order_id IS NOT NULL
     AND k.state = 'paid' AND k.refunded_at IS NULL AND pe.erased_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.person_id = k.person_id
       AND a.type IN ('first_fit', 'replacement') AND ${statusIn("a.status", VISIT_LIVE)} AND a.deleted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM slot_holds h WHERE h.person_id = k.person_id
       AND h.type IN ('first_fit', 'replacement') AND ${paidNotBooked("h")})`,
};

/**
 * The board's queues for a hair system made to a client's size: the ask to order one, then, once paid for, its order
 * to send and its piece to fit.
 */
export const MADE_TO_ORDER_QUEUES = [MADE_TO_ORDER_QUEUE, CUSTOM_ORDER_TO_SEND, CUSTOM_PIECE_TO_FIT] as const;
