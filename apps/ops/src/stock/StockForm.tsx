// Recording a movement of stock (docs/decisions/0087-consumables-and-stock.md): a delivery, a transfer, a count or a
// loss, checked first with what each place holds beside what it will (ADR 0071). A hair system's pieces are named by
// their scanned labels (docs/decisions/0162-scanning-labels.md); a top-up to a kit counts once the technician scans it
// in (docs/decisions/0164-the-kit-screen.md).

import { Toast } from "@maneman/ui/Toast";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { Checkbox, ChoiceGroup, Radio } from "@maneman/ui/Field";
import { Button } from "@maneman/ui/Button";
import { useState } from "react";
import { type Stock } from "../api.ts";
import { stock as copy } from "../content/stock.ts";
import { CheckPanel } from "../components/CheckPanel.tsx";
import form from "../components/forms.module.css";
import { LotFields } from "./LotFields.tsx";
import { PieceScans } from "./PieceScans.tsx";
import { holdingOf, unitOf } from "./holdings.ts";
import styles from "./stock-form.module.css";
import { FormRefusal } from "../components/Refusal.tsx";
import { FormActions } from "../components/FormActions.tsx";
import { NoteBox, Quantity, StockChoice, stockBoxes, type Refused } from "./StockBoxes.tsx";
import { stockApi } from "./stock-api.ts";

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
  /** A hair system's pieces, by their labels as scanned; their count is the quantity. */
  readonly units: readonly string[];
  /** To a kit: whether it waits for the technician's scan, as it does unless handed over in person. */
  readonly waitForScan: boolean;
}

type Step = { readonly step: "editing" | "checking" | "saving" | "recorded" } | ({ readonly step: "failed" } & Failure);

const WHOLE = /^\d{1,6}$/;

/** A place by name: a kit by its technician's, marked once they left, and a hub or a stockroom marked once closed. */
export function placeName(stock: Stock, id: string): string {
  const place = [...stock.places, ...stock.other_places].find((each) => each.id === id);
  if (place === undefined) return id;
  if (place.active) return place.name;
  return place.kind === "kit" ? copy.left(place.name) : copy.closed(place.name);
}

/** The warehouse a delivery goes into, which is "central" in the ledger. */
const warehouseOf = (stock: Stock) => stock.places.find((each) => each.kind === "warehouse")?.id ?? "central";

/** What each place the movement touches holds now, beside what it will hold, and any that would go below nothing. */
function effectOf(stock: Stock, draft: Draft): { lines: string[]; warnings: string[] } {
  const consumable = stock.consumables.find((each) => each.code === draft.code);
  const unit = consumable?.unit ?? "";
  const held = (place: string) => holdingOf(stock, draft.code, place)?.quantity ?? 0;
  const said = (quantity: number) => copy.held(quantity, unit);
  const moved = Number(draft.quantity);
  const changes: [string, number][] = [];
  if (draft.kind === "delivery") changes.push([warehouseOf(stock), moved]);
  // A top-up waiting for the technician's scan leaves now and arrives only then.
  const waiting = toAKit(stock, draft) && draft.waitForScan;
  if (draft.kind === "transfer")
    changes.push([draft.from, -moved], ...(waiting ? [] : [[draft.to, moved] as [string, number]]));
  if (draft.kind === "write_off") changes.push([draft.place, -moved]);
  if (draft.kind === "count") {
    const place = draft.place;
    const counted = Number(draft.counted);
    if (counted === held(place)) return { lines: [copy.confirm.same], warnings: [] };
    changes.push([place, counted - held(place)]);
  }
  return {
    lines: [
      ...changes.map(([place, by]) =>
        copy.confirm.line(placeName(stock, place), said(held(place)), said(held(place) + by)),
      ),
      ...(waiting ? [copy.confirm.onItsWay(placeName(stock, draft.to))] : []),
    ],
    warnings: changes
      .filter(([place, by]) => held(place) + by < 0)
      .map(([place]) => copy.confirm.below(placeName(stock, place))),
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

async function sent(stock: Stock, draft: Draft) {
  const code = draft.code;
  const note = draft.note.trim() === "" ? null : draft.note.trim();
  switch (draft.kind) {
    case "delivery":
      return stockApi.recordDelivery({
        consumable_code: code,
        quantity: Number(draft.quantity),
        note,
        lot_code: draft.lotCode.trim() === "" ? null : draft.lotCode.trim(),
        expires_on: draft.expiresOn === "" ? null : draft.expiresOn,
      });
    case "transfer":
      return stockApi.recordTransfer({
        consumable_code: code,
        quantity: Number(draft.quantity),
        from: draft.from,
        to: draft.to,
        ...scannedOf(draft),
        ...(toAKit(stock, draft) ? { wait_for_scan: draft.waitForScan } : {}),
      });
    case "count":
      return stockApi.recordCount({
        consumable_code: code,
        place_id: draft.place,
        counted: Number(draft.counted),
        note,
        lot_code: draft.lotCode.trim() === "" ? null : draft.lotCode.trim(),
        expires_on: draft.expiresOn === "" ? null : draft.expiresOn,
      });
    case "write_off":
      return stockApi.recordWriteOff({
        consumable_code: code,
        place_id: draft.place,
        quantity: Number(draft.quantity),
        note: draft.note.trim(),
        lot_id: draft.lotId === "" ? null : draft.lotId,
        ...scannedOf(draft),
      });
  }
}

/** Whether a transfer goes to a technician's kit. */
const toAKit = (stock: Stock, draft: Draft) =>
  draft.kind === "transfer" && stock.places.some((place) => place.id === draft.to && place.kind === "kit");

/** The pieces named, where any were scanned. */
const scannedOf = (draft: Draft) => (draft.units.length === 0 ? {} : { units: [...draft.units] });

/** Whether the movement names its pieces: a hair system's transfer or loss. */
const scans = (stock: Stock, draft: Draft) =>
  (draft.kind === "transfer" || draft.kind === "write_off") &&
  stock.consumables.some((each) => each.code === draft.code && each.hair_system);

/** Whether a top-up to a kit waits for the technician to scan it in, as it does unless ops hand it over in person. */
function WaitForScan({ stock, draft, onDraft }: { stock: Stock; draft: Draft; onDraft: (draft: Draft) => void }) {
  if (!toAKit(stock, draft)) return null;
  return (
    <Checkbox
      label={copy.record.waitForScan}
      checked={draft.waitForScan}
      onChange={(event) => {
        onDraft({ ...draft, waitForScan: event.target.checked });
      }}
    />
  );
}

/** How many: what a count found, or what moves; nothing to type where pieces were scanned, which count themselves. */
function HowMany(props: {
  draft: Draft;
  unit: string;
  onEdit: (field: "counted" | "quantity") => (text: string) => void;
  refused: Refused;
}) {
  const { draft, unit, onEdit, refused } = props;
  if (draft.kind === "count") {
    return (
      <Quantity
        label={copy.record.inUnit(copy.record.counted, unit)}
        value={draft.counted}
        onChange={onEdit("counted")}
        error={refused("counted")}
      />
    );
  }
  if (draft.units.length > 0) return null;
  return (
    <Quantity
      label={copy.record.inUnit(copy.record.quantity, unit)}
      value={draft.quantity}
      onChange={onEdit("quantity")}
      error={refused("quantity")}
    />
  );
}

/** What every box holds before anything is typed. */
const EMPTY = {
  quantity: "",
  counted: "",
  note: "",
  lotCode: "",
  expiresOn: "",
  lotId: "",
  units: [],
  waitForScan: true,
};

/** What moved: the kind of movement, the item, and the places it moved between or was counted or lost at. */
function WhatMoved(props: {
  stock: Stock;
  draft: Draft;
  kinds: readonly Kind[];
  places: readonly (readonly [string, string])[];
  onEdit: (field: Exclude<keyof Draft, "units" | "waitForScan">) => (value: string) => void;
  refused: Refused;
}) {
  const { stock, draft, kinds, places, refused } = props;
  const edit = props.onEdit;
  return (
    <>
      <ChoiceGroup className={styles.kinds} legend={copy.record.what} inline>
        {kinds.map((kind) => (
          <Radio
            key={kind}
            label={copy.record.kinds[kind]}
            name="stock-kind"
            value={kind}
            checked={draft.kind === kind}
            onChange={() => {
              edit("kind")(kind);
            }}
          />
        ))}
      </ChoiceGroup>
      <div className={form.fields}>
        <StockChoice
          label={copy.record.consumable}
          value={draft.code}
          options={stock.consumables.map((each) => [each.code, each.name] as const)}
          onChange={edit("code")}
          error={refused("consumable_code")}
        />
        {draft.kind === "transfer" && (
          <>
            <StockChoice
              label={copy.record.from}
              value={draft.from}
              options={places}
              onChange={edit("from")}
              error={refused("from")}
            />
            <StockChoice
              label={copy.record.to}
              value={draft.to}
              options={places}
              onChange={edit("to")}
              error={refused("to")}
            />
          </>
        )}
        {(draft.kind === "count" || draft.kind === "write_off") && (
          <StockChoice
            label={copy.record.place}
            value={draft.place}
            options={places}
            onChange={edit("place")}
            error={refused("place_id")}
          />
        )}
      </div>
    </>
  );
}

/** The boxes the form draws for this movement, whose refusals their Fields say. */
const drawnBoxes = (stock: Stock, draft: Draft) =>
  stockBoxes(draft.kind, draft.units.length > 0, (holdingOf(stock, draft.code, draft.place)?.lots.length ?? 0) > 0);

/** Records a movement of one of `kinds`: those the caller may record, in KINDS' order. */
export function StockForm({
  stock,
  kinds,
  onRecorded,
}: {
  stock: Stock;
  kinds: readonly [Kind, ...Kind[]];
  onRecorded: (stock: Stock, recorded: { readonly kind: Kind; readonly code: string }) => void;
}) {
  const places = stock.places.map((place) => [place.id, placeName(stock, place.id)] as const);
  // The warehouse first where the caller's grants reach it, else their first place.
  const [first = "", second] = places.map(([value]) => value);
  const offered = stock.consumables.filter((each) => !each.retired);
  const [draft, setDraft] = useState<Draft>(() => ({
    ...EMPTY,
    kind: kinds[0],
    code: offered[0]?.code ?? "",
    from: first,
    to: second ?? first,
    place: first,
  }));
  const [step, setStep] = useState<Step>({ step: "editing" });
  const edit = (field: Exclude<keyof Draft, "units" | "waitForScan">) => (value: string) => {
    // Pieces scanned belong to one stock code and one kind of movement.
    setDraft({
      ...draft,
      [field]: value,
      ...(field === "code" || field === "kind" ? { units: [], quantity: "" } : {}),
    });
    setStep({ step: "editing" });
  };
  const scan = (units: readonly string[]) => {
    setDraft({ ...draft, units, quantity: units.length === 0 ? "" : String(units.length) });
    setStep({ step: "editing" });
  };
  const unit = unitOf(stock, draft.code);
  const checking = step.step === "checking" || step.step === "saving";
  const failure = step.step === "failed" ? step : null;
  const refused = (box: string) => boxError(copy.errors, failure, box);
  const effect = effectOf(stock, draft);

  const send = async () => {
    setStep({ step: "saving" });
    const answer = await sent(stock, draft);
    if (!answer.ok) {
      setStep({ step: "failed", code: answer.code, fields: answer.fields });
      return;
    }
    onRecorded(answer.body, { kind: draft.kind, code: draft.code });
    setDraft({ ...draft, ...EMPTY });
    setStep({ step: "recorded" });
  };

  return (
    <div className={styles.record}>
      <WhatMoved stock={stock} draft={draft} kinds={kinds} places={places} onEdit={edit} refused={refused} />
      <LotFields stock={stock} draft={draft} onEdit={edit} refused={refused} />
      {scans(stock, draft) && <PieceScans units={draft.units} onUnits={scan} />}
      <WaitForScan stock={stock} draft={draft} onDraft={setDraft} />
      <div className={form.fields}>
        <HowMany draft={draft} unit={unit} onEdit={edit} refused={refused} />
        {draft.kind !== "transfer" && (
          <NoteBox lost={draft.kind === "write_off"} note={draft.note} onNote={edit("note")} error={refused("note")} />
        )}
      </div>
      {checking ? (
        <CheckPanel
          lines={effect.lines}
          warnings={effect.warnings}
          busy={step.step === "saving"}
          onSend={() => void send()}
          onBack={() => {
            setStep({ step: "editing" });
          }}
        />
      ) : (
        <FormActions>
          <Button
            variant="primary"
            size="small"
            disabled={!readyOf(draft, stock.max_quantity)}
            onClick={() => {
              setStep({ step: "checking" });
            }}
          >
            {copy.record.check}
          </Button>
        </FormActions>
      )}
      {step.step === "recorded" && <Toast>{copy.recorded}</Toast>}
      <FormRefusal className={form.error} errors={copy.errors} failure={failure} boxes={drawnBoxes(stock, draft)} />
    </div>
  );
}
