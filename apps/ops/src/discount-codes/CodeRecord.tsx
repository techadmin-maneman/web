// A discount code's record (docs/decisions/0108-discount-codes.md): what it takes off, on what, until when, and what
// it has come to. Until a booking takes it, its terms change and it is deleted (0283-changed-and-deleted-while-unused);
// after, its values only read, and at its foot it is switched off, asked once.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { errorText } from "@maneman/web-kit/refusal";
import { rupees } from "@maneman/web-kit/money";
import { type DiscountCode } from "../api.ts";
import { DeleteAction } from "@maneman/ui/DeleteAction";
import { ReadRow } from "@maneman/ui/RecordRows";
import form from "@maneman/ui/forms.module.css";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { Button } from "@maneman/ui/Button";
import { useState } from "react";
import { ChangeCodeForm } from "./DiscountCodeForm.tsx";
import { discountCodesApi } from "./discount-codes-api.ts";

const copy = settings.discountCodes;
const columns = copy.columns;

export function CodeRecord(props: {
  readonly code: DiscountCode;
  /** What it takes off, what it covers, when it ends, how far it is used and when last: as its row reads them. */
  readonly reads: Readonly<Record<"discount" | "covers" | "ends" | "uses" | "lastUsed" | "offOn", string>>;
  readonly onDone: (said: string) => Promise<void>;
  /** India's date today, the earliest a changed code may end. */
  readonly today: string;
}) {
  const { code, reads } = props;
  const access = useAccess();
  const [changing, setChanging] = useState(false);
  if (changing) {
    return (
      <ChangeCodeForm
        code={code}
        today={props.today}
        onChanged={() => void props.onDone(copy.changed)}
        onClose={() => {
          setChanging(false);
        }}
      />
    );
  }
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
        {code.deletable && access.mayCall("PATCH /api/discount-codes/{id}") && (
          <Button
            icon={ACTION_ICONS.pencil}
            variant="outline"
            size="small"
            onClick={() => {
              setChanging(true);
            }}
          >
            {copy.change}
          </Button>
        )}
        {code.switched_off === null && access.mayCall("POST /api/discount-codes/{id}/off") && (
          <DeleteAction
            icon={ACTION_ICONS.powerOff}
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
            refusal={(refused) => errorText(copy.errors, { code: refused })}
            onDeleted={() => props.onDone(copy.deleted)}
          />
        )}
      </div>
    </>
  );
}
