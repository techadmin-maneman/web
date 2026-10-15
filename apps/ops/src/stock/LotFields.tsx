// The lot a movement names (docs/decisions/0157-lots-and-expiry.md): a delivery's supplier lot and the day it expires,
// both optional, the stock code's shelf life standing in for an expiry not given; a count's, for what it found more of
// than was held, as at an opening count (0160); and the lot a loss was, as one that expired, or by default the lots
// that expire soonest.

import { Field, Select, TextInput } from "@maneman/ui/Field";
import { fullDate } from "@maneman/web-kit/dates";
import type { Stock } from "../api.ts";
import { stock as copy } from "../content/stock.ts";
import form from "../components/forms.module.css";
import { holdingOf } from "./holdings.ts";

/** What the fields read and write of the movement being recorded. */
interface LotDraft {
  readonly kind: string;
  readonly code: string;
  readonly place: string;
  readonly lotCode: string;
  readonly expiresOn: string;
  readonly lotId: string;
}

export function LotFields({
  stock,
  draft,
  onEdit,
  refused,
}: {
  stock: Stock;
  draft: LotDraft;
  onEdit: (field: "lotCode" | "expiresOn" | "lotId") => (value: string) => void;
  /** Words for a box the API refused, by the name it refused it by. */
  refused: (box: string) => string | null;
}) {
  if (draft.kind === "delivery" || draft.kind === "count") {
    return (
      <div className={form.fields}>
        <Field label={copy.record.lot} className={form.field} error={refused("lot_code")}>
          {(control) => (
            <TextInput
              {...control}
              maxLength={40}
              value={draft.lotCode}
              onChange={(event) => {
                onEdit("lotCode")(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={copy.record.expires} className={form.field} error={refused("expires_on")}>
          {(control) => (
            <TextInput
              {...control}
              type="date"
              value={draft.expiresOn}
              onChange={(event) => {
                onEdit("expiresOn")(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
    );
  }
  const lots = holdingOf(stock, draft.code, draft.place)?.lots ?? [];
  if (draft.kind !== "write_off" || lots.length === 0) return null;
  return (
    <div className={form.fields}>
      <Field label={copy.record.lostLot} className={form.field} error={refused("lot_id")}>
        {(control) => (
          <Select
            {...control}
            width="choice"
            value={draft.lotId}
            onChange={(event) => {
              onEdit("lotId")(event.target.value);
            }}
          >
            <option value="">{copy.record.soonest}</option>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {copy.record.lotLine(lot.lot_code, lot.expires_on === null ? null : fullDate(lot.expires_on))}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}
