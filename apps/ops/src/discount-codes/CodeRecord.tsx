// A discount code's record (docs/decisions/0108-discount-codes.md): what it takes off, on what, until when, and what
// it has come to. A code never changes once made, so its values only read; at its foot it is switched off, asked once,
// or deleted while no booking has taken it.

import { errorText } from "@maneman/web-kit/refusal";
import { rupees } from "@maneman/web-kit/money";
import { type DiscountCode } from "../api.ts";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { ReadRow } from "../components/RecordRows.tsx";
import form from "../components/forms.module.css";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { discountCodesApi } from "./discount-codes-api.ts";

const copy = settings.discountCodes;
const columns = copy.columns;

export function CodeRecord(props: {
  readonly code: DiscountCode;
  /** What it takes off, what it covers, when it ends, how far it is used and when last: as its row reads them. */
  readonly reads: Readonly<Record<"discount" | "covers" | "ends" | "uses" | "lastUsed" | "offOn", string>>;
  readonly onDone: (said: string) => Promise<void>;
}) {
  const { code, reads } = props;
  const access = useAccess();
  const rows: readonly (readonly [string, string])[] = [
    [columns.discount, reads.discount],
    [columns.covers, reads.covers],
    [columns.ends, reads.ends],
    [columns.uses, reads.uses],
    [columns.clients, String(code.clients)],
    [columns.given, rupees(code.given)],
    [columns.paid, rupees(code.paid)],
    [columns.lastUsed, reads.lastUsed],
    ...(code.switched_off === null ? [] : [[columns.offOn, reads.offOn] as const]),
  ];
  return (
    <>
      <div className={form.record}>
        {rows.map(([label, value]) => (
          <ReadRow key={label} label={label} value={value} />
        ))}
      </div>
      <div className={form.recordFoot}>
        {code.switched_off === null && access.mayCall("POST /api/discount-codes/{id}/off") && (
          <DeleteAction
            name={code.code}
            tone="danger"
            words={{ ...copy.switching, warning: (name: string) => copy.switching.warning(name, code.uses) }}
            send={() => discountCodesApi.switchOffDiscountCode(code.id)}
            refusal={(refused) => errorText(copy.errors, { code: refused })}
            onDeleted={() => props.onDone(copy.switchedOff)}
          />
        )}
        {code.deletable && access.mayCall("POST /api/discount-codes/{id}/delete") && (
          <DeleteAction
            name={code.code}
            send={() => discountCodesApi.deleteDiscountCode(code.id)}
            refusal={(refused) => (refused === "in_use" ? copy.inUse : errorText(copy.errors, { code: refused }))}
            onDeleted={() => props.onDone(copy.deleted)}
          />
        )}
      </div>
    </>
  );
}
