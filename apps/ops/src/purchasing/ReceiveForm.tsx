// What arrived of an order at the warehouse (docs/decisions/0167-receipts-and-landed-cost.md): for each line how many
// were accepted, damaged or failed their check, its lot and expiry; and the receipt's supplier invoice, rupee rate for an
// order in another currency, and its freight, duty and clearing, which the landed cost shares out.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Button } from "@maneman/ui/Button";
import { Field, Fieldset, TextInput } from "@maneman/ui/Field";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { paiseFromRupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { client } from "../api.ts";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import type { Order, Orders } from "./types.ts";
import styles from "./purchasing.module.css";

interface LineDraft {
  readonly received: string;
  readonly damaged: string;
  readonly failed: string;
  readonly lot: string;
  readonly expires: string;
}

const WHOLE = /^\d{1,7}$/;
const RUPEES = /^\d{1,9}(?:\.\d{1,2})?$/;

function Entry(props: { label: string; value: string; type?: string; onChange: (text: string) => void }) {
  return (
    <Field label={props.label} className={form.field}>
      {(control) => (
        <TextInput
          {...control}
          className={props.type === "date" ? undefined : form.figureBox}
          type={props.type ?? "text"}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

function LineFields(props: { name: string; draft: LineDraft; onDraft: (draft: LineDraft) => void }) {
  const { draft, onDraft } = props;
  const set = (field: keyof LineDraft) => (text: string) => {
    onDraft({ ...draft, [field]: text });
  };
  return (
    <Fieldset className={styles.line} legend={props.name}>
      <Entry label={copy.receive.received} value={draft.received} onChange={set("received")} />
      <Entry label={copy.receive.damaged} value={draft.damaged} onChange={set("damaged")} />
      <Entry label={copy.receive.failed} value={draft.failed} onChange={set("failed")} />
      <Entry label={copy.receive.lot} value={draft.lot} onChange={set("lot")} />
      <Entry label={copy.receive.expires} value={draft.expires} type="date" onChange={set("expires")} />
    </Fieldset>
  );
}

/** The receipt's own figures, as typed: its invoice, rupee rate, freight, duty and clearing. */
interface Extras {
  readonly invoice: string;
  readonly rate: string;
  readonly freight: string;
  readonly duty: string;
  readonly clearing: string;
}

function ExtrasFields({
  order,
  extras,
  onExtras,
}: {
  order: Order;
  extras: Extras;
  onExtras: (extras: Extras) => void;
}) {
  const extra = (field: keyof Extras) => (text: string) => {
    onExtras({ ...extras, [field]: text });
  };
  return (
    <div className={form.fields}>
      <Entry label={copy.receive.invoice} value={extras.invoice} onChange={extra("invoice")} />
      {order.currency !== "INR" && (
        <Entry label={copy.receive.rate(order.currency)} value={extras.rate} onChange={extra("rate")} />
      )}
      <Entry label={copy.receive.freight} value={extras.freight} onChange={extra("freight")} />
      <Entry label={copy.receive.duty} value={extras.duty} onChange={extra("duty")} />
      <Entry label={copy.receive.clearing} value={extras.clearing} onChange={extra("clearing")} />
    </div>
  );
}

/** The receipt as the API takes it, from what was typed. */
function receiptBody(order: Order, lines: readonly LineDraft[], extras: Extras) {
  return {
    lines: order.lines.map((line, index) => {
      const draft = lines[index];
      return {
        po_line_id: line.id,
        received: Number(draft?.received ?? 0),
        damaged: Number(draft?.damaged ?? 0),
        qc_failed: Number(draft?.failed ?? 0),
        lot_code: draft === undefined || draft.lot.trim() === "" ? null : draft.lot.trim(),
        expires_on: draft === undefined || draft.expires === "" ? null : draft.expires,
      };
    }),
    supplier_invoice: extras.invoice.trim() === "" ? null : extras.invoice.trim(),
    rupee_rate: order.currency === "INR" ? null : paiseFromRupees(extras.rate),
    freight_paise: paiseFromRupees(extras.freight),
    duty_paise: paiseFromRupees(extras.duty),
    clearing_paise: paiseFromRupees(extras.clearing),
    note: null,
  };
}

export function ReceiveForm(props: {
  book: Orders;
  order: Order;
  onReceived: (book: Orders, said: string) => void;
  onCancel: () => void;
}) {
  const { book, order } = props;
  const [lines, setLines] = useState<readonly LineDraft[]>(() =>
    order.lines.map((line) => ({
      received: String(Math.max(0, line.quantity - line.received)),
      damaged: "0",
      failed: "0",
      lot: "",
      expires: "",
    })),
  );
  const [extras, setExtras] = useState<Extras>({ invoice: "", rate: "", freight: "0", duty: "0", clearing: "0" });
  const [failure, setFailure] = useState<Failure | null>(null);
  const foreign = order.currency !== "INR";
  const named = (code: string) => book.consumables.find((each) => each.code === code)?.name ?? code;
  const ready =
    lines.every((line) => [line.received, line.damaged, line.failed].every((figure) => WHOLE.test(figure.trim()))) &&
    [extras.freight, extras.duty, extras.clearing].every((amount) => RUPEES.test(amount.trim())) &&
    (!foreign || RUPEES.test(extras.rate.trim()));
  const send = async () => {
    const body = receiptBody(order, lines, extras);
    const answer = await client.post("/api/purchase-orders/{id}/receipts", { path: { id: order.id }, body });
    if (answer.ok) props.onReceived(answer.body, copy.receive.done);
    else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <div className={form.group} role="group" aria-label={copy.receive.title}>
      {order.lines.map((line, index) => (
        <LineFields
          key={line.id}
          name={named(line.consumable_code)}
          draft={lines[index] ?? { received: "0", damaged: "0", failed: "0", lot: "", expires: "" }}
          onDraft={(draft) => {
            setLines(lines.map((each, at) => (at === index ? draft : each)));
          }}
        />
      ))}
      <ExtrasFields order={order} extras={extras} onExtras={setExtras} />
      <div className={form.actions}>
        <Button variant="primary" size="small" disabled={!ready} onClick={() => void send()}>
          {copy.receive.send}
        </Button>
        <Button variant="outline" size="small" onClick={props.onCancel}>
          {copy.receive.cancel}
        </Button>
      </div>
      {failure !== null && (
        <InlineMessage tone="error" className={form.error}>
          {errorText(copy.errors, failure)}
        </InlineMessage>
      )}
    </div>
  );
}
