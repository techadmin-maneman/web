// Recording a movement of stock (docs/decisions/0087-consumables-and-stock.md):
// a delivery into the warehouse, a transfer between two places, a count,
// or a loss somebody saw. Before anything is sent, the check shows what each
// place holds now beside what it will hold (ADR 0071); a count shows the
// figure it finds, and the ledger takes the difference. A place that would
// hold less than nothing says so, since a delivery or a count is then missing.

import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { Field, NumberInput, Select } from "@maneman/ui/Field";
import { Button } from "@maneman/ui/Button";
import { useState } from "react";
import { api, type Stock } from "../api.ts";
import { stock as copy } from "../content.ts";
import { CheckPanel } from "../components/CheckPanel.tsx";
import form from "../components/forms.module.css";
import { LotFields } from "./LotFields.tsx";
import styles from "./stock.module.css";

export const KINDS = ["delivery", "transfer", "count", "write_off"] as const;
export type Kind = (typeof KINDS)[number];

interface Draft {
  readonly kind: Kind;
  readonly code: string;
  readonly quantity: string;
  readonly from: string;
  readonly to: string;
  readonly place: string;
  readonly counted: string;
  readonly note: string;
  readonly lotCode: string;
  readonly expiresOn: string;
  readonly lotId: string;
}

type Step = { readonly step: "editing" | "checking" | "saving" | "recorded" } | ({ readonly step: "failed" } & Failure);

const WHOLE = /^\d{1,6}$/;

/** A place by name: a kit by its technician's, marked once they left, and a hub or a stockroom marked once closed. */
export function placeName(book: Stock, id: string): string {
  const place = book.places.find((each) => each.id === id);
  if (place === undefined) return id;
  if (place.active) return place.name;
  return place.kind === "kit" ? copy.left(place.name) : copy.closed(place.name);
}

/** The warehouse a delivery goes into, which is "central" in the ledger. */
const warehouseOf = (book: Stock) => book.places.find((each) => each.kind === "warehouse")?.id ?? "central";

/** One of the consumables or the places, by name. */
function Choice(props: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <Field label={props.label} className={form.field}>
      {(control) => (
        <Select
          {...control}
          className={form.choiceBox}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        >
          {props.options.map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** How many, kept as typed until it is sent. */
function Quantity(props: { label: string; hint?: string; value: string; onChange: (text: string) => void }) {
  return (
    <Field label={props.label} hint={props.hint} className={form.field}>
      {(control) => (
        <NumberInput
          {...control}
          className={form.figureBox}
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

/** What each place the movement touches holds now, beside what it will hold, and any that would go below nothing. */
function effectOf(book: Stock, draft: Draft): { lines: string[]; warnings: string[] } {
  const consumable = book.consumables.find((each) => each.code === draft.code);
  const unit = consumable?.unit ?? "";
  const held = (place: string) =>
    book.holdings.find((each) => each.consumable_code === draft.code && each.place_id === place)?.quantity ?? 0;
  const said = (quantity: number) => copy.held(quantity, unit);
  const moved = Number(draft.quantity);
  const changes: [string, number][] = [];
  if (draft.kind === "delivery") changes.push([warehouseOf(book), moved]);
  if (draft.kind === "transfer") changes.push([draft.from, -moved], [draft.to, moved]);
  if (draft.kind === "write_off") changes.push([draft.place, -moved]);
  if (draft.kind === "count") {
    const place = draft.place;
    const counted = Number(draft.counted);
    if (counted === held(place)) return { lines: [copy.confirm.same], warnings: [] };
    changes.push([place, counted - held(place)]);
  }
  return {
    lines: changes.map(([place, by]) =>
      copy.confirm.line(placeName(book, place), said(held(place)), said(held(place) + by)),
    ),
    warnings: changes
      .filter(([place, by]) => held(place) + by < 0)
      .map(([place]) => copy.confirm.below(placeName(book, place))),
  };
}

function readyOf(draft: Draft, max: number): boolean {
  const within = (text: string, least: number) =>
    WHOLE.test(text.trim()) && Number(text) >= least && Number(text) <= max;
  if (draft.code === "") return false;
  if (draft.kind === "count") return within(draft.counted, 0);
  if (!within(draft.quantity, 1)) return false;
  if (draft.kind === "transfer") return draft.from !== draft.to;
  if (draft.kind === "write_off") return draft.note.trim() !== "";
  return true;
}

async function sent(draft: Draft) {
  const code = draft.code;
  const note = draft.note.trim() === "" ? null : draft.note.trim();
  switch (draft.kind) {
    case "delivery":
      return api.recordDelivery({
        consumable_code: code,
        quantity: Number(draft.quantity),
        note,
        lot_code: draft.lotCode.trim() === "" ? null : draft.lotCode.trim(),
        expires_on: draft.expiresOn === "" ? null : draft.expiresOn,
      });
    case "transfer":
      return api.recordTransfer({
        consumable_code: code,
        quantity: Number(draft.quantity),
        from: draft.from,
        to: draft.to,
      });
    case "count":
      return api.recordCount({
        consumable_code: code,
        place_id: draft.place,
        counted: Number(draft.counted),
        note,
        lot_code: draft.lotCode.trim() === "" ? null : draft.lotCode.trim(),
        expires_on: draft.expiresOn === "" ? null : draft.expiresOn,
      });
    case "write_off":
      return api.recordWriteOff({
        consumable_code: code,
        place_id: draft.place,
        quantity: Number(draft.quantity),
        note: draft.note.trim(),
        lot_id: draft.lotId === "" ? null : draft.lotId,
      });
  }
}

/** What every box holds before anything is typed. */
const EMPTY = { quantity: "", counted: "", note: "", lotCode: "", expiresOn: "", lotId: "" };

/** Records a movement of one of `kinds`: those the caller may record, in KINDS' order. */
export function StockForm({
  book,
  kinds,
  onRecorded,
}: {
  book: Stock;
  kinds: readonly [Kind, ...Kind[]];
  onRecorded: (book: Stock, recorded: { readonly kind: Kind; readonly code: string }) => void;
}) {
  const places = book.places.map((place) => [place.id, placeName(book, place.id)] as const);
  // The warehouse first where the caller's grants reach it, else their first place.
  const [first = "", second] = places.map(([value]) => value);
  const offered = book.consumables.filter((each) => !each.retired);
  const [draft, setDraft] = useState<Draft>(() => ({
    ...EMPTY,
    kind: kinds[0],
    code: offered[0]?.code ?? "",
    from: first,
    to: second ?? first,
    place: first,
  }));
  const [step, setStep] = useState<Step>({ step: "editing" });
  const edit = (field: keyof Draft) => (value: string) => {
    setDraft({ ...draft, [field]: value });
    setStep({ step: "editing" });
  };
  const unit = book.consumables.find((each) => each.code === draft.code)?.unit ?? "";
  const checking = step.step === "checking" || step.step === "saving";
  const effect = effectOf(book, draft);

  const send = async () => {
    setStep({ step: "saving" });
    const answer = await sent(draft);
    if (!answer.ok) {
      setStep({ step: "failed", code: answer.code, fields: answer.fields });
      return;
    }
    onRecorded(answer.body, { kind: draft.kind, code: draft.code });
    setDraft({ ...draft, ...EMPTY });
    setStep({ step: "recorded" });
  };

  return (
    <section className={form.panel} aria-labelledby="stock-record">
      <div className={form.panelHead}>
        <h2 className={form.panelTitle} id="stock-record">
          {copy.record.title}
        </h2>
      </div>
      <div className={form.group}>
        <fieldset className={styles.kinds}>
          <legend className={styles.kindsLegend}>{copy.record.what}</legend>
          {kinds.map((kind) => (
            <label className={styles.kind} key={kind}>
              <input
                className={styles.radio}
                type="radio"
                name="stock-kind"
                value={kind}
                checked={draft.kind === kind}
                onChange={() => {
                  edit("kind")(kind);
                }}
              />
              {copy.record.kinds[kind]}
            </label>
          ))}
        </fieldset>
        <div className={form.fields}>
          <Choice
            label={copy.record.consumable}
            value={draft.code}
            options={book.consumables.map((each) => [each.code, each.name] as const)}
            onChange={edit("code")}
          />
          {draft.kind === "transfer" && (
            <>
              <Choice label={copy.record.from} value={draft.from} options={places} onChange={edit("from")} />
              <Choice label={copy.record.to} value={draft.to} options={places} onChange={edit("to")} />
            </>
          )}
          {(draft.kind === "count" || draft.kind === "write_off") && (
            <Choice label={copy.record.place} value={draft.place} options={places} onChange={edit("place")} />
          )}
        </div>
        <LotFields book={book} draft={draft} onEdit={edit} />
        <div className={form.fields}>
          {draft.kind === "count" ? (
            <Quantity
              label={copy.record.inUnit(copy.record.counted, unit)}

              value={draft.counted}
              onChange={edit("counted")}
            />
          ) : (
            <Quantity
              label={copy.record.inUnit(copy.record.quantity, unit)}

              value={draft.quantity}
              onChange={edit("quantity")}
            />
          )}
          {draft.kind !== "transfer" && (
            <div className={form.field}>
              <label className={form.fieldLabel} htmlFor="stock-note">
                {draft.kind === "write_off" ? copy.record.lossNote : copy.record.note}
              </label>
              <input
                className={form.text}
                id="stock-note"
                type="text"
                maxLength={200}
                value={draft.note}
                onChange={(event) => {
                  edit("note")(event.target.value);
                }}
              />
            </div>
          )}
        </div>
        {checking ? (
          <CheckPanel
            title={copy.confirm.title}
            lines={effect.lines}
            warnings={effect.warnings}
            send={copy.confirm.send}
            sending={copy.confirm.send}
            back={copy.confirm.back}
            busy={step.step === "saving"}
            onSend={() => void send()}
            onBack={() => {
              setStep({ step: "editing" });
            }}
          />
        ) : (
          <div className={form.actions}>
            <Button
              variant="primary"
              size="small"
              disabled={!readyOf(draft, book.max_quantity)}
              onClick={() => {
                setStep({ step: "checking" });
              }}
            >
              {copy.record.check}
            </Button>
          </div>
        )}
        {step.step === "recorded" && (
          <p className={form.saved} role="status">
            {copy.recorded}
          </p>
        )}
        {step.step === "failed" && (
          <p className={form.error} role="alert">
            {errorText(copy.errors, step)}
          </p>
        )}
      </div>
    </section>
  );
}
