// Stock · In transit (docs/decisions/0158-transfers-in-transit.md): what was sent to a warehouse, a hub or a stockroom
// and has not arrived. The place it went to receives it, in full or short, with a word on what was lost; the place it
// left can send it back before it arrives. A hair system's pieces that arrived are scanned, and those not scanned
// went missing on the way (docs/decisions/0162-scanning-labels.md).

import { Panel } from "@maneman/ui/Panel";
import { CancelButton } from "@maneman/ui/CancelButton";
import { Button, RowButton } from "@maneman/ui/Button";
import { Field, NumberInput, TextInput } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { ACTIONS, FIGURE, RowActions, Table, TableScroll } from "@maneman/ui/Table";
import { SortHeads } from "@maneman/ui/TableTools";
import { useTableView } from "@maneman/ui/useTableView";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { boxError, errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { type Stock } from "../api.ts";
import { stockTransit as copy } from "../content/stock-transit.ts";
import form from "@maneman/ui/forms.module.css";
import { useAccess } from "../lib/access.ts";
import { PieceScans } from "./PieceScans.tsx";
import { placeName } from "./StockForm.tsx";
import { unitOf } from "./holdings.ts";
import { FormRefusal, Refusal } from "@maneman/ui/Refusal";
import { RowHead } from "@maneman/ui/RowHead";
import { FormActions } from "@maneman/ui/FormActions";
import { stockApi } from "./stock-api.ts";

type Transfer = Stock["in_transit"][number];

/** What arrived of one transfer, and a word on it, before it is recorded. */
function Receiving(props: { stock: Stock; transfer: Transfer; onDone: (stock: Stock | null) => void }) {
  const { stock, transfer } = props;
  const [typed, setArrived] = useState(String(transfer.quantity));
  const [units, setUnits] = useState<readonly string[]>([]);
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const consumable = stock.consumables.find((each) => each.code === transfer.consumable_code);
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
    const answer = await stockApi.receiveTransfer(transfer.id, body);
    if (answer.ok) props.onDone(answer.body);
    else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <div className={form.group}>
      {consumable?.hair_system === true && <PieceScans units={units} onUnits={setUnits} />}
      <div className={form.fields}>
        <Field
          label={`${copy.arrived} (${unit})`}
          className={form.field}
          error={boxError(copy.errors, failure, "received")}
        >
          {(control) => (
            <NumberInput
              {...control}
              width="figure"
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
        <Field label={copy.note} className={form.field} error={boxError(copy.errors, failure, "note")}>
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
      {ready && figure < transfer.quantity && <Note>{copy.short(transfer.quantity - figure, unit)}</Note>}
      <FormActions>
        <Button variant="primary" size="small" disabled={!ready} onClick={() => void record()}>
          {copy.confirm}
        </Button>
        <CancelButton
          onClick={() => {
            props.onDone(null);
          }}
        />
      </FormActions>
      <FormRefusal className={form.error} errors={copy.errors} failure={failure} boxes={["received", "note"]} />
    </div>
  );
}

function TransferRow(props: { stock: Stock; transfer: Transfer; onReceive: () => void; onSendBack: () => void }) {
  const { stock, transfer } = props;
  const access = useAccess();
  const what =
    stock.consumables.find((each) => each.code === transfer.consumable_code)?.name ?? transfer.consumable_code;
  const unit = unitOf(stock, transfer.consumable_code);
  const from = placeName(stock, transfer.from);
  const to = placeName(stock, transfer.to);
  return (
    <tr>
      <RowHead>{what}</RowHead>
      <td className={FIGURE}>
        {transfer.quantity} {unit}
      </td>
      <td>{from}</td>
      <td>{to}</td>
      <td>{shortDate(indiaDate(transfer.sent_at))}</td>
      <td className={ACTIONS}>
        <RowActions>
          {access.mayCall("POST /api/stock/transfers/{id}/receive") && (
            <RowButton aria-label={copy.receiveLabel(what, to)} onClick={props.onReceive}>
              {copy.receive}
            </RowButton>
          )}
          {access.mayCall("POST /api/stock/transfers/{id}/send-back") && (
            <RowButton aria-label={copy.sendBackLabel(what, from)} onClick={props.onSendBack}>
              {copy.sendBack}
            </RowButton>
          )}
        </RowActions>
      </td>
    </tr>
  );
}

export function InTransit({ stock, onChanged }: { stock: Stock; onChanged: (stock: Stock) => void }) {
  const [receiving, setReceiving] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const transfer = stock.in_transit.find((each) => each.id === receiving);
  const nameOf = (each: Transfer) =>
    stock.consumables.find((consumable) => consumable.code === each.consumable_code)?.name ?? each.consumable_code;
  const [item, many, from, to, sent] = copy.columns;
  const view = useTableView(stock.in_transit, [
    { label: item, sort: nameOf },
    { label: many, sort: (each: Transfer) => each.quantity, figure: true },
    { label: from, sort: (each: Transfer) => placeName(stock, each.from) },
    { label: to, sort: (each: Transfer) => placeName(stock, each.to) },
    { label: sent, sort: (each: Transfer) => each.sent_at },
  ]);
  const sendBack = async (id: string) => {
    setFailure(null);
    const answer = await stockApi.sendBack(id);
    if (answer.ok) onChanged(answer.body);
    else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <Panel titleId="stock-in-transit" title={copy.title}>
      <TableScroll labelledBy="stock-in-transit">
        <Table controls>
          <thead>
            <tr>
              <SortHeads view={view} />
              <th scope="col">
                <VisuallyHidden>{copy.actions}</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {view.shown.map((each) => (
              <TransferRow
                key={each.id}
                stock={stock}
                transfer={each}
                onReceive={() => {
                  setReceiving(each.id);
                }}
                onSendBack={() => void sendBack(each.id)}
              />
            ))}
          </tbody>
        </Table>
      </TableScroll>
      {transfer !== undefined && (
        <Receiving
          key={transfer.id}
          stock={stock}
          transfer={transfer}
          onDone={(next) => {
            setReceiving(null);
            if (next !== null) onChanged(next);
          }}
        />
      )}
      {failure !== null && <Refusal className={form.error} said={errorText(copy.errors, failure)} />}
    </Panel>
  );
}
