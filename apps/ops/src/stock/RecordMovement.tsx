// "Record a movement": the drawer Stock opens from its head, and a technician's Kit tab from theirs, starting at their
// kit. A delivery goes into the warehouse, so a kit's drawer offers the rest.

import { DrawerButton } from "@maneman/ui/DrawerButton";
import type { Stock } from "../api.ts";
import { stock as copy } from "../content/stock.ts";
import { useAccess, type OpsCall } from "../lib/access.ts";
import { KINDS, StockForm, type Kind } from "./StockForm.tsx";

/** The call that records each movement. A delivery goes into the warehouse, which only national staff reach. */
const RECORDING: Readonly<Record<Kind, OpsCall>> = {
  delivery: "POST /api/stock/deliveries",
  transfer: "POST /api/stock/transfers",
  count: "POST /api/stock/counts",
  write_off: "POST /api/stock/write-offs",
};

export function RecordMovement(props: {
  stock: Stock;
  /** The place the drawer starts at, a technician's kit; the warehouse where none is named. */
  at?: string;
  onRecorded: (after: Stock, recorded: { readonly kind: Kind; readonly code: string }, close: () => void) => void;
}) {
  const access = useAccess();
  const [firstKind, ...otherKinds] = KINDS.filter(
    (kind) => (props.at === undefined || kind !== "delivery") && access.mayCall(RECORDING[kind]),
  );
  if (firstKind === undefined || props.stock.consumables.length === 0) return null;
  return (
    <DrawerButton primary label={copy.record.title}>
      {(close) => (
        <StockForm
          stock={props.stock}
          at={props.at}
          kinds={[firstKind, ...otherKinds]}
          onRecorded={(after, recorded) => {
            props.onRecorded(after, recorded, close);
          }}
        />
      )}
    </DrawerButton>
  );
}
