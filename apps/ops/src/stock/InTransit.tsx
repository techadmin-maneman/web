// Stock · In transit (docs/decisions/0158-transfers-in-transit.md): what was sent to a warehouse, a hub or a stockroom
// and has not arrived. The place it went to receives it, in full or short, with a word on what was lost; the place it
// left can send it back before it arrives. A hair system's pieces that arrived are scanned, and those not scanned
// went missing on the way (docs/decisions/0162-scanning-labels.md).

import { Button } from "@maneman/ui/Button";
import { Field, NumberInput, TextInput } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { client, type Stock } from "../api.ts";
import { stockTransit as copy } from "../content/stock-transit.ts";
import form from "../components/forms.module.css";
import { useAccess } from "../lib/access.ts";
import { PieceScans } from "./PieceScans.tsx";
import { placeName } from "./StockForm.tsx";
import styles from "./stock.module.css";

type Transfer = Stock["in_transit"][number];

/** What arrived of one transfer, and a word on it, before it is recorded. */
function Receiving(props: { book: Stock; transfer: Transfer; onDone: (book: Stock | null) => void }) {
  const { book, transfer } = props;
  const [typed, setArrived] = useState(String(transfer.quantity));
  const [units, setUnits] = useState<readonly string[]>([]);
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const consumable = book.consumables.find((each) => each.code === transfer.consumable_code);
  const unit = consumable?.unit ?? "";
  const arrived = units.length > 0 ? String(units.length) : typed;
  const figure = Number(arrived);
  const ready = /^\d{1,6}$/.test(arrived.trim()) && figure <= transfer.quantity;
  const record = async () => {
    const body = {
      received: figure,
      ...(units.length === 0 ? {} : { units: [...units] }),
      ...(note.trim() === "" ? {} : { note: note.trim() }),
    };
    const answer = await client.post("/api/stock/transfers/{id}/receive", { path: { id: transfer.id }, body });
    if (answer.ok) props.onDone(answer.body);
    else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <div className={form.group}>
      {consumable?.hair_system === true && <PieceScans units={units} onUnits={setUnits} />}
      <div className={form.fields}>
        <Field label={`${copy.arrived} (${unit})`} className={form.field}>
          {(control) => (
            <NumberInput
              {...control}
              className={form.figureBox}
              type="text"
              inputMode="numeric"
              maxLength={6}
              readOnly={units.length > 0}
              value={arrived}
              onChange={(event) => {
                setArrived(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={copy.note} className={form.field}>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      {ready && figure < transfer.quantity && (
        <p className={form.note}>{copy.short(transfer.quantity - figure, unit)}</p>
      )}
      <div className={form.actions}>
        <Button variant="primary" size="small" disabled={!ready} onClick={() => void record()}>
          {copy.confirm}
        </Button>
        <Button
          variant="outline"
          size="small"
          onClick={() => {
            props.onDone(null);
          }}
        >
          {copy.cancel}
        </Button>
      </div>
      {failure !== null && (
        <p className={form.error} role="alert">
          {errorText(copy.errors, failure)}
        </p>
      )}
    </div>
  );
}

function Row(props: { book: Stock; transfer: Transfer; onReceive: () => void; onSendBack: () => void }) {
  const { book, transfer } = props;
  const access = useAccess();
  const what =
    book.consumables.find((each) => each.code === transfer.consumable_code)?.name ?? transfer.consumable_code;
  const unit = book.consumables.find((each) => each.code === transfer.consumable_code)?.unit ?? "";
  const from = placeName(book, transfer.from);
  const to = placeName(book, transfer.to);
  return (
    <tr>
      <th scope="row" className={form.rowHead}>
        {what}
      </th>
      <td className={form.figure}>
        {transfer.quantity} {unit}
      </td>
      <td>{from}</td>
      <td>{to}</td>
      <td className={form.figure}>{shortDate(indiaDate(transfer.sent_at))}</td>
      <td className={styles.held}>
        {access.mayCall("POST /api/stock/transfers/{id}/receive") && (
          <button
            className={form.inline}
            type="button"
            aria-label={copy.receiveLabel(what, to)}
            onClick={props.onReceive}
          >
            {copy.receive}
          </button>
        )}{" "}
        {access.mayCall("POST /api/stock/transfers/{id}/send-back") && (
          <button
            className={form.inline}
            type="button"
            aria-label={copy.sendBackLabel(what, from)}
            onClick={props.onSendBack}
          >
            {copy.sendBack}
          </button>
        )}
      </td>
    </tr>
  );
}

export function InTransit({ book, onChanged }: { book: Stock; onChanged: (book: Stock) => void }) {
  const [receiving, setReceiving] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const transfer = book.in_transit.find((each) => each.id === receiving);
  const sendBack = async (id: string) => {
    setFailure(null);
    const answer = await client.post("/api/stock/transfers/{id}/send-back", { path: { id } });
    if (answer.ok) onChanged(answer.body);
    else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <section className={form.panel} aria-labelledby="stock-in-transit">
      <div className={form.panelHead}>
        <h2 className={form.panelTitle} id="stock-in-transit">
          {copy.title}
        </h2>
      </div>
      <div className={styles.scroll}>
        <Table className={form.table}>
          <thead>
            <tr>
              {copy.columns.map((column, index) => (
                <th scope="col" key={index}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {book.in_transit.map((each) => (
              <Row
                key={each.id}
                book={book}
                transfer={each}
                onReceive={() => {
                  setReceiving(each.id);
                }}
                onSendBack={() => void sendBack(each.id)}
              />
            ))}
          </tbody>
        </Table>
      </div>
      {transfer !== undefined && (
        <Receiving
          key={transfer.id}
          book={book}
          transfer={transfer}
          onDone={(next) => {
            setReceiving(null);
            if (next !== null) onChanged(next);
          }}
        />
      )}
      {failure !== null && (
        <p className={form.error} role="alert">
          {errorText(copy.errors, failure)}
        </p>
      )}
    </section>
  );
}
