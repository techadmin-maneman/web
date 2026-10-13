// One recall (docs/decisions/0187-recalls.md): where its lot's stock is, who wears its pieces, and its close once dealt
// with; and a lot recalled, with why.

import { fullDate } from "@maneman/web-kit/dates";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { useState } from "react";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { BookVisit } from "../clients/index.ts";
import { quality as copy } from "../content/quality.ts";
import { useAccess } from "../lib/access.ts";

export type Book = paths["/api/recalls"]["get"]["responses"][200]["content"]["application/json"];
export type Detail = paths["/api/recalls/{id}"]["get"]["responses"][200]["content"]["application/json"];

/** What a step answered: the recall, or the refusal. */
export type Answer =
  | { readonly ok: true; readonly body: Detail }
  | { readonly ok: false; readonly code: string; readonly fields: readonly string[] };

function Rows({ columns, rows }: { columns: readonly string[]; rows: readonly (readonly [string, ...string[]])[] }) {
  return (
    <Table className={form.table}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([head, ...cells]) => (
          <tr key={`${head}-${cells.join("-")}`}>
            <th scope="row" className={form.rowHead}>
              {head}
            </th>
            {cells.map((cell, index) => (
              <td key={index}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

type Worn = Detail["worn"][number];

/** A worn piece's replacement, booked free from the recall (docs/decisions/0192-free-remakes.md). */
function BookFree({ worn }: { worn: Worn }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="small"
        aria-label={copy.bookFreeLabel(worn.person)}
        onClick={() => {
          setOpen(true);
        }}
      >
        {copy.bookFree}
      </Button>
      {open && (
        <BookVisit
          clientId={worn.person_id}
          name={worn.person}
          prefill={{ choice: "replacement", covers: worn.piece_id }}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function WornRows({ worn, mayBook }: { worn: readonly Worn[]; mayBook: boolean }) {
  return (
    <Table className={form.table}>
      <thead>
        <tr>
          {copy.wornColumns.map((column, index) => (
            <th key={index} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {worn.map((each) => (
          <tr key={each.piece_id}>
            <th scope="row" className={form.rowHead}>
              {each.person}
            </th>
            <td>{each.piece_code}</td>
            <td>{each.due_on === null ? "" : fullDate(each.due_on)}</td>
            <td>{mayBook && <BookFree worn={each} />}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function RecallDetail({
  recall,
  onAnswer,
}: {
  recall: Detail;
  onAnswer: (answer: Answer, said: string) => void;
}) {
  const access = useAccess();
  const title = `${copy.number(recall.number)} · ${copy.lotLabel(recall.name, recall.lot_code)}`;
  return (
    <Panel titleId="recall-detail" title={title}>
      <p className={form.note}>{recall.reason}</p>
      <h3 className={form.ruleTitle}>{copy.held}</h3>
      {recall.held.length === 0 ? (
        <p className={form.note}>{copy.noneHeld}</p>
      ) : (
        <Rows
          columns={copy.heldColumns}
          rows={recall.held.map((each) => [each.place, String(each.quantity)] as const)}
        />
      )}
      <h3 className={form.ruleTitle}>{copy.worn}</h3>
      {recall.worn.length === 0 ? (
        <p className={form.note}>{copy.noneWorn}</p>
      ) : (
        <WornRows worn={recall.worn} mayBook={recall.closed_at === null && access.mayCall("POST /api/visits")} />
      )}
      {recall.closed_at === null && access.mayCall("POST /api/recalls/{id}/close") && (
        <div className={form.actions}>
          <Button
            variant="outline"
            size="small"
            onClick={() =>
              void client.post("/api/recalls/{id}/close", { path: { id: recall.id } }).then((answer) => {
                onAnswer(answer, copy.closedSaid);
              })
            }
          >
            {copy.close}
          </Button>
        </div>
      )}
    </Panel>
  );
}

export function RaiseRecall({ book, onAnswer }: { book: Book; onAnswer: (answer: Answer, said: string) => void }) {
  const [lot, setLot] = useState(book.lots[0]?.id ?? "");
  const [reason, setReason] = useState("");
  if (book.lots.length === 0) return null;
  return (
    <div className={form.group}>
      <h3 className={form.ruleTitle}>{copy.raise}</h3>
      <Field label={copy.lot} className={form.field}>
        {(control) => (
          <Select
            {...control}
            className={form.choiceBox}
            value={lot}
            onChange={(event) => {
              setLot(event.target.value);
            }}
          >
            {book.lots.map((each) => (
              <option key={each.id} value={each.id}>
                {copy.lotLabel(each.name, each.lot_code)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={copy.reason} className={form.field}>
        {(control) => (
          <TextInput
            {...control}
            maxLength={200}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        )}
      </Field>
      <div className={form.actions}>
        <Button
          variant="destructive"
          size="small"
          disabled={lot === "" || reason.trim() === ""}
          onClick={() =>
            void client.post("/api/recalls", { body: { lot_id: lot, reason: reason.trim() } }).then((answer) => {
              onAnswer(answer, copy.raisedSaid);
              if (answer.ok) setReason("");
            })
          }
        >
          {copy.confirmRaise}
        </Button>
      </div>
    </div>
  );
}
