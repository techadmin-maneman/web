// One recall (docs/decisions/0187-recalls.md): where its lot's stock is, who wears its pieces, and its close once dealt
// with; and a lot recalled, with why.

import type { Success } from "@maneman/web-kit/api";
import { plainDate } from "@maneman/web-kit/plain-date";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Note } from "@maneman/ui/Note";
import { ACTIONS, Table } from "@maneman/ui/Table";
import { NoValue } from "@maneman/ui/NoValue";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { SortHeads } from "@maneman/ui/TableTools";
import { useTableView } from "@maneman/ui/useTableView";
import { useState } from "react";
import type { paths } from "../api-schema.ts";
import form from "@maneman/ui/forms.module.css";
import { BookVisit } from "../clients/index.ts";
import { quality as copy } from "../content/quality.ts";
import { stock } from "../content/stock.ts";
import { useAccess } from "../lib/access.ts";
import { FormActions } from "@maneman/ui/FormActions";
import { RowHead } from "@maneman/ui/RowHead";
import { qualityApi } from "./quality-api.ts";

export type Quality = Success<paths["/api/recalls"]["get"]>;
export type Detail = Success<paths["/api/recalls/{id}"]["get"]>;

/** What a step answered: the recall, or the refusal. */
export type Answer =
  | { readonly ok: true; readonly body: Detail }
  | { readonly ok: false; readonly code: string; readonly fields: readonly string[] };

type Line = readonly [string, ...string[]];

/** A recall's held stock, a place a row: each column sorts by its words. */
function Rows({ columns, rows }: { columns: readonly string[]; rows: readonly Line[] }) {
  const view = useTableView(
    rows,
    columns.map((label, at) => ({ label, sort: (row: Line) => row[at] ?? "" })),
  );
  return (
    <Table>
      <thead>
        <tr>
          <SortHeads view={view} />
        </tr>
      </thead>
      <tbody>
        {view.shown.map(([head, ...cells]) => (
          <tr key={`${head}-${cells.join("-")}`}>
            <RowHead>{head}</RowHead>
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
  const [client, piece, due] = copy.wornColumns;
  const view = useTableView(worn, [
    { label: client, sort: (each: Worn) => each.person },
    { label: piece, sort: (each: Worn) => each.piece_code },
    { label: due, sort: (each: Worn) => each.due_on ?? "" },
  ]);
  return (
    <Table controls>
      <thead>
        <tr>
          <SortHeads view={view} />
          <th scope="col">
            <VisuallyHidden>{copy.bookFree}</VisuallyHidden>
          </th>
        </tr>
      </thead>
      <tbody>
        {view.shown.map((each) => (
          <tr key={each.piece_id}>
            <RowHead>{each.person}</RowHead>
            <td>{each.piece_code}</td>
            <td>{each.due_on === null ? <NoValue /> : plainDate(each.due_on)}</td>
            <td className={ACTIONS}>{mayBook && <BookFree worn={each} />}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function RecallDetail({
  id,
  recall,
  onAnswer,
}: {
  id: string;
  recall: Detail;
  onAnswer: (answer: Answer, said: string) => void;
}) {
  const access = useAccess();
  const title = `${copy.number(recall.number)} · ${copy.lotLabel(recall.name, recall.lot_code)}`;
  return (
    <Panel id={id} opened titleId="recall-detail" title={title}>
      <Note>{recall.reason}</Note>
      <h3 className={form.ruleTitle}>{copy.held}</h3>
      {recall.held.length === 0 ? (
        <EmptyState look="panel" line={copy.noneHeld} />
      ) : (
        <Rows
          columns={copy.heldColumns}
          rows={recall.held.map((each) => [each.place, stock.held(each.quantity, recall.unit)] as const)}
        />
      )}
      <h3 className={form.ruleTitle}>{copy.worn}</h3>
      {recall.worn.length === 0 ? (
        <EmptyState look="panel" line={copy.noneWorn} />
      ) : (
        <WornRows worn={recall.worn} mayBook={recall.closed_at === null && access.mayCall("POST /api/visits")} />
      )}
      {recall.closed_at === null && access.mayCall("POST /api/recalls/{id}/close") && (
        <FormActions>
          <Button
            variant="outline"
            size="small"
            onClick={() =>
              void qualityApi.closeRecall(recall.id).then((answer) => {
                onAnswer(answer, copy.closedSaid);
              })
            }
          >
            {copy.close}
          </Button>
        </FormActions>
      )}
    </Panel>
  );
}

export function RaiseRecall({
  quality,
  onAnswer,
}: {
  quality: Quality;
  onAnswer: (answer: Answer, said: string) => void;
}) {
  const [lot, setLot] = useState(quality.lots[0]?.id ?? "");
  const [reason, setReason] = useState("");
  if (quality.lots.length === 0) return null;
  return (
    <div className={form.group}>
      <h3 className={form.ruleTitle}>{copy.raise}</h3>
      <Field label={copy.lot} className={form.field}>
        {(control) => (
          <Select
            {...control}
            width="choice"
            value={lot}
            onChange={(event) => {
              setLot(event.target.value);
            }}
          >
            {quality.lots.map((each) => (
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
      <FormActions>
        <Button
          variant="destructive"
          size="small"
          disabled={lot === "" || reason.trim() === ""}
          onClick={() =>
            void qualityApi.raiseRecall({ lot_id: lot, reason: reason.trim() }).then((answer) => {
              onAnswer(answer, copy.raisedSaid);
              if (answer.ok) setReason("");
            })
          }
        >
          {copy.confirmRaise}
        </Button>
      </FormActions>
    </div>
  );
}
