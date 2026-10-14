// A new purchase order (docs/decisions/0166-purchase-orders.md): a supplier, and lines of what it lists, each at least
// its minimum, at the price it lists; the total shown before it is drafted. Drafting sends nothing to the supplier: an
// order goes out only once approved and marked sent.

import { ICONS } from "@maneman/brand/icons";
import { IconButton } from "@maneman/ui/IconButton";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { inCurrency } from "@maneman/web-kit/money";
import { useState } from "react";
import { client } from "../api.ts";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import type { Orders } from "./types.ts";
import styles from "./purchasing.module.css";
import { Refusal } from "../components/Refusal.tsx";
import { FormActions } from "../components/FormActions.tsx";

interface Line {
  readonly code: string;
  readonly quantity: string;
}

const WHOLE = /^\d{1,7}$/;

/** How many times over Settings' cost a supplier's price must be to be questioned. */
const FAR_ABOVE = 5;

function LineBoxes(props: {
  line: Line;
  items: Orders["suppliers"][number]["items"];
  currency: string;
  consumable: (code: string) => Orders["consumables"][number] | undefined;
  onLine: (line: Line) => void;
  onRemove: () => void;
}) {
  const { line, items, currency, consumable } = props;
  const item = items.find((each) => each.consumable_code === line.code);
  const listed = consumable(line.code);
  const unit = listed?.unit ?? "";
  const named = (code: string) => consumable(code)?.name ?? code;
  const times =
    item === undefined || listed === undefined || listed.unit_cost === 0 ? 0 : item.unit_price / listed.unit_cost;
  const questioned = currency === "INR" && times >= FAR_ABOVE && item !== undefined && listed !== undefined;
  return (
    <div className={styles.line}>
      <Field label={copy.draft.item} className={form.field}>
        {(control) => (
          <Select
            {...control}
            className={form.choiceBox}
            value={line.code}
            onChange={(event) => {
              props.onLine({ ...line, code: event.target.value });
            }}
          >
            {items.map((each) => (
              <option key={each.consumable_code} value={each.consumable_code}>
                {named(each.consumable_code)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label={copy.draft.quantity}
        hint={
          item === undefined
            ? undefined
            : copy.draft.minimum(item.minimum_order, item.pack_size, unit, inCurrency(item.unit_price, currency))
        }
        className={form.field}
      >
        {(control) => (
          <TextInput
            {...control}
            className={form.figureBox}
            inputMode="numeric"
            maxLength={7}
            value={line.quantity}
            onChange={(event) => {
              props.onLine({ ...line, quantity: event.target.value });
            }}
          />
        )}
      </Field>
      <IconButton d={ICONS.cross} size={16} label={copy.draft.removeLine(named(line.code))} onClick={props.onRemove} />
      {questioned && (
        <Refusal
          className={form.error}
          said={copy.draft.farAbove(
            inCurrency(item.unit_price, currency),
            unit,
            Math.round(times),
            inCurrency(listed.unit_cost, "INR"),
          )}
        />
      )}
    </div>
  );
}

type Supplier = Orders["suppliers"][number];

/** The supplier ordered from: only those that list something. */
function SupplierPick(props: { stocked: readonly Supplier[]; supplierId: string; onPick: (id: string) => void }) {
  const { stocked, supplierId, onPick } = props;
  return (
    <>
      <Field label={copy.draft.supplier} className={form.field}>
        {(control) => (
          <Select
            {...control}
            className={form.choiceBox}
            value={supplierId}
            onChange={(event) => {
              onPick(event.target.value);
            }}
          >
            {stocked.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </>
  );
}

/** The order's lines, each of a stock code the supplier lists, and a way to add the next it lists. */
function LinesEditor(props: {
  supplier: Supplier;
  lines: readonly Line[];
  consumable: (code: string) => Orders["consumables"][number] | undefined;
  onLines: (lines: readonly Line[]) => void;
}) {
  const { supplier, lines, consumable, onLines } = props;
  return (
    <>
      <div className={styles.lines}>
        {lines.map((line, index) => (
          <LineBoxes
            key={`${line.code}-${String(index)}`}
            line={line}
            items={supplier.items}
            currency={supplier.currency}
            consumable={consumable}
            onLine={(next) => {
              onLines(lines.map((each, at) => (at === index ? next : each)));
            }}
            onRemove={() => {
              onLines(lines.filter((_, at) => at !== index));
            }}
          />
        ))}
      </div>
      <FormActions>
        <Button
          variant="outline"
          size="small"
          onClick={() => {
            const next = supplier.items.find((each) => !lines.some((line) => line.code === each.consumable_code));
            if (next !== undefined)
              onLines([...lines, { code: next.consumable_code, quantity: String(next.minimum_order) }]);
          }}
        >
          {copy.draft.addLine}
        </Button>
      </FormActions>
    </>
  );
}

/** When the supplier promised it, and a note, both optional. */
function WhenAndNote(props: {
  expected: string;
  note: string;
  onExpected: (date: string) => void;
  onNote: (note: string) => void;
}) {
  const { expected, note, onExpected, onNote } = props;
  return (
    <div className={form.fields}>
      <Field label={copy.draft.expected} className={form.field}>
        {(control) => (
          <TextInput
            {...control}
            type="date"
            value={expected}
            onChange={(event) => {
              onExpected(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={copy.draft.note} className={form.field}>
        {(control) => (
          <TextInput
            {...control}
            maxLength={200}
            value={note}
            onChange={(event) => {
              onNote(event.target.value);
            }}
          />
        )}
      </Field>
    </div>
  );
}

export function DraftOrder({
  orders,
  onDrafted,
}: {
  orders: Orders;
  onDrafted: (orders: Orders, said: string) => void;
}) {
  const stocked = orders.suppliers.filter((each) => each.items.length > 0);
  const [supplierId, setSupplierId] = useState(stocked[0]?.id ?? "");
  const supplier = stocked.find((each) => each.id === supplierId);
  const firstItem = supplier?.items[0];
  const [lines, setLines] = useState<readonly Line[]>(() =>
    firstItem === undefined ? [] : [{ code: firstItem.consumable_code, quantity: String(firstItem.minimum_order) }],
  );
  const [expected, setExpected] = useState("");
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  if (supplier === undefined) return <p className={form.note}>{copy.draft.noItems}</p>;
  /** A supplier picked starts from its first item, at its minimum. */
  const pick = (id: string) => {
    const item = stocked.find((each) => each.id === id)?.items[0];
    setSupplierId(id);
    setLines(item === undefined ? [] : [{ code: item.consumable_code, quantity: String(item.minimum_order) }]);
  };
  const consumable = (code: string) => orders.consumables.find((each) => each.code === code);
  const priceOf = (code: string) => supplier.items.find((each) => each.consumable_code === code)?.unit_price ?? 0;
  const total = lines.reduce((sum, line) => sum + priceOf(line.code) * Number(line.quantity), 0);
  const ready =
    lines.length > 0 && lines.every((line) => WHOLE.test(line.quantity.trim()) && Number(line.quantity) > 0);
  const draft = async () => {
    const body = {
      supplier_id: supplier.id,
      lines: lines.map((line) => ({ consumable_code: line.code, quantity: Number(line.quantity) })),
      expected_on: expected === "" ? null : expected,
      note: note.trim() === "" ? null : note.trim(),
    };
    const answer = await client.post("/api/purchase-orders", { body });
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      return;
    }
    // A drafted order clears the form, so the same lines are not drafted twice.
    pick(supplier.id);
    setExpected("");
    setNote("");
    onDrafted(answer.body, copy.draft.drafted);
  };
  return (
    <Panel titleId="draft-order" title={copy.draft.title}>
      <SupplierPick stocked={stocked} supplierId={supplierId} onPick={pick} />
      <LinesEditor supplier={supplier} lines={lines} consumable={consumable} onLines={setLines} />
      <WhenAndNote expected={expected} note={note} onExpected={setExpected} onNote={setNote} />
      <p className={form.note}>{copy.draft.total(inCurrency(total, supplier.currency))}</p>
      <FormActions>
        <Button variant="primary" size="small" disabled={!ready} onClick={() => void draft()}>
          {copy.draft.send}
        </Button>
      </FormActions>
      {failure !== null && <Refusal className={form.error} said={errorText(copy.errors, failure)} />}
    </Panel>
  );
}
