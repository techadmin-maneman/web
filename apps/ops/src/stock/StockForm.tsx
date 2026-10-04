// Recording a movement of stock (docs/decisions/0087-consumables-and-stock.md):
// a delivery into the central store, a transfer between two places, a count,
// or a loss somebody saw. Before anything is sent, the check shows what each
// place holds now beside what it will hold (ADR 0071); a count shows the
// figure it finds, and the ledger takes the difference. A place that would
// hold less than nothing says so, since a delivery or a count is then missing.

import { Button } from "@maneman/ui/Button";
import { useState } from "react";
import { api, type Stock } from "../api.ts";
import { stock as copy } from "../content.ts";
import { CheckPanel } from "../settings/CheckPanel.tsx";
import { refusalOf, type Failure } from "../settings/refusal.ts";
import form from "../settings/settings.module.css";
import styles from "./stock.module.css";

export const KINDS = ["delivery", "transfer", "count", "write_off"] as const;
export type Kind = (typeof KINDS)[number];

/** A place in a select: the central store, or a technician's kit by his ID. */
const CENTRAL = "central";
const placeOf = (value: string): string | null => (value === CENTRAL ? null : value);

interface Draft {
  readonly kind: Kind;
  readonly code: string;
  readonly quantity: string;
  readonly from: string;
  readonly to: string;
  readonly place: string;
  readonly counted: string;
  readonly note: string;
}

type Step = { readonly step: "editing" | "checking" | "saving" | "recorded" } | ({ readonly step: "failed" } & Failure);

const WHOLE = /^\d{1,6}$/;

export function placeName(book: Stock, technicianId: string | null): string {
  if (technicianId === null) return copy.central;
  const place = book.places.find((each) => each.technician_id === technicianId);
  if (place?.name === null || place?.name === undefined) return technicianId;
  return place.active ? place.name : copy.left(place.name);
}

function Select(props: {
  id: string;
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <div className={form.field}>
      <label className={form.fieldLabel} htmlFor={props.id}>
        {props.label}
      </label>
      <select
        className={form.select}
        id={props.id}
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
      </select>
    </div>
  );
}

function Figure(props: { id: string; label: string; hint?: string; value: string; onChange: (text: string) => void }) {
  return (
    <div className={form.field}>
      <label className={form.fieldLabel} htmlFor={props.id}>
        {props.label}
      </label>
      <input
        className={form.number}
        id={props.id}
        type="text"
        inputMode="numeric"
        maxLength={6}
        value={props.value}
        aria-describedby={props.hint === undefined ? undefined : `${props.id}-hint`}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
      {props.hint !== undefined && (
        <p className={form.hint} id={`${props.id}-hint`}>
          {props.hint}
        </p>
      )}
    </div>
  );
}

/** What each place the movement touches holds now, beside what it will hold, and any that would go below nothing. */
function effectOf(book: Stock, draft: Draft): { lines: string[]; warnings: string[] } {
  const consumable = book.consumables.find((each) => each.code === draft.code);
  const unit = consumable?.unit ?? "";
  const held = (place: string | null) =>
    book.holdings.find((each) => each.consumable_code === draft.code && each.technician_id === place)?.quantity ?? 0;
  const said = (quantity: number) => copy.held(quantity, unit);
  const moved = Number(draft.quantity);
  const changes: [string | null, number][] = [];
  if (draft.kind === "delivery") changes.push([null, moved]);
  if (draft.kind === "transfer") changes.push([placeOf(draft.from), -moved], [placeOf(draft.to), moved]);
  if (draft.kind === "write_off") changes.push([placeOf(draft.place), -moved]);
  if (draft.kind === "count") {
    const place = placeOf(draft.place);
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
      return api.recordDelivery({ consumable_code: code, quantity: Number(draft.quantity), note });
    case "transfer":
      return api.recordTransfer({
        consumable_code: code,
        quantity: Number(draft.quantity),
        from: placeOf(draft.from),
        to: placeOf(draft.to),
      });
    case "count":
      return api.recordCount({
        consumable_code: code,
        technician_id: placeOf(draft.place),
        counted: Number(draft.counted),
        note,
      });
    case "write_off":
      return api.recordWriteOff({
        consumable_code: code,
        technician_id: placeOf(draft.place),
        quantity: Number(draft.quantity),
        note: draft.note.trim(),
      });
  }
}

/** Records a movement of one of `kinds`: those the caller may record, in KINDS' order. */
export function StockForm({
  book,
  kinds,
  onRecorded,
}: {
  book: Stock;
  kinds: readonly [Kind, ...Kind[]];
  onRecorded: (book: Stock) => void;
}) {
  const places = book.places.map(
    (place) => [place.technician_id ?? CENTRAL, placeName(book, place.technician_id)] as const,
  );
  // The store first where the caller's grants reach it, else their first kit.
  const [first, second] = places.map(([value]) => value);
  const offered = book.consumables.filter((each) => !each.retired);
  const [draft, setDraft] = useState<Draft>({
    kind: kinds[0],
    code: offered[0]?.code ?? "",
    quantity: "",
    from: first ?? CENTRAL,
    to: second ?? first ?? CENTRAL,
    place: first ?? CENTRAL,
    counted: "",
    note: "",
  });
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
    onRecorded(answer.body);
    setDraft({ ...draft, quantity: "", counted: "", note: "" });
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
          <Select
            id="stock-consumable"
            label={copy.record.consumable}
            value={draft.code}
            options={book.consumables.map((each) => [each.code, each.name] as const)}
            onChange={edit("code")}
          />
          {draft.kind === "transfer" && (
            <>
              <Select
                id="stock-from"
                label={copy.record.from}
                value={draft.from}
                options={places}
                onChange={edit("from")}
              />
              <Select id="stock-to" label={copy.record.to} value={draft.to} options={places} onChange={edit("to")} />
            </>
          )}
          {(draft.kind === "count" || draft.kind === "write_off") && (
            <Select
              id="stock-place"
              label={copy.record.place}
              value={draft.place}
              options={places}
              onChange={edit("place")}
            />
          )}
        </div>
        <div className={form.fields}>
          {draft.kind === "count" ? (
            <Figure
              id="stock-counted"
              label={copy.record.counted}
              hint={copy.record.quantityHint(unit, book.max_quantity)}
              value={draft.counted}
              onChange={edit("counted")}
            />
          ) : (
            <Figure
              id="stock-quantity"
              label={copy.record.quantity}
              hint={copy.record.quantityHint(unit, book.max_quantity)}
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
                aria-describedby="stock-note-hint"
                onChange={(event) => {
                  edit("note")(event.target.value);
                }}
              />
              <p className={form.hint} id="stock-note-hint">
                {copy.record.noteHint}
              </p>
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
            {refusalOf(copy.errors, step)}
          </p>
        )}
      </div>
    </section>
  );
}
