// Returned pieces handed in, to settle (docs/decisions/0169-supplier-claims.md): each with its supplier's warranty,
// claimed while inside it, or written off with why.

import { Button, RowButton } from "@maneman/ui/Button";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { NoValue } from "@maneman/ui/NoValue";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { CancelButton } from "@maneman/ui/CancelButton";
import { Field, TextInput } from "@maneman/ui/Field";
import { EmptyState } from "@maneman/ui/EmptyState";
import { ACTIONS, RowActions, Table } from "@maneman/ui/Table";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "@maneman/ui/forms.module.css";
import { useAccess } from "../lib/access.ts";
import type { ClaimAnswer } from "./ClaimSteps.tsx";
import { StockPhoto } from "./StockPhoto.tsx";
import type { ReturnedPiece } from "./types.ts";
import { RowHead } from "@maneman/ui/RowHead";
import { FormActions } from "@maneman/ui/FormActions";
import { purchasingApi } from "./purchasing-api.ts";

function warrantyOf(piece: ReturnedPiece): string {
  if (piece.warranty_ends_on === null) return copy.returns.unknown;
  const day = shortDate(piece.warranty_ends_on);
  return piece.in_warranty ? copy.returns.until(day) : copy.returns.ended(day);
}

/** Writing a piece off, with why and a photograph, in a drawer beside the list. */
function WriteOffForm({
  piece,
  onAnswer,
  onCancel,
}: {
  piece: ReturnedPiece;
  onAnswer: (answer: ClaimAnswer, said: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [photoId, setPhotoId] = useState<string | null>(null);
  return (
    <>
      <div className={form.fields}>
        <Field label={copy.returns.why} className={form.field}>
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
        <StockPhoto label={copy.photo.writeOff} photoId={photoId} onPhoto={setPhotoId} />
      </div>
      <FormActions>
        <Button
          variant="destructive"
          size="small"
          disabled={reason.trim() === "" || photoId === null}
          onClick={() =>
            void purchasingApi
              .writeOffReturned(piece.id, { reason: reason.trim(), photo_id: photoId ?? "" })
              .then((answer) => {
                onAnswer(answer, copy.returns.writtenOff);
              })
          }
        >
          {copy.returns.confirmWriteOff}
        </Button>
        <CancelButton onClick={onCancel} />
      </FormActions>
    </>
  );
}

function WriteOff({
  piece,
  onAnswer,
}: {
  piece: ReturnedPiece;
  onAnswer: (answer: ClaimAnswer, said: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <RowButton
        aria-label={copy.returns.writeOffLabel(piece.piece_code)}
        onClick={() => {
          setOpen(true);
        }}
      >
        {copy.returns.writeOff}
      </RowButton>
      {open && (
        <FormDrawer title={copy.returns.writeOffLabel(piece.piece_code)} onClose={close}>
          <WriteOffForm
            piece={piece}
            onAnswer={(answer, said) => {
              if (answer.ok) close();
              onAnswer(answer, said);
            }}
            onCancel={close}
          />
        </FormDrawer>
      )}
    </>
  );
}

const [pieceHead, itemHead, returnedHead, handedHead, warrantyHead] = copy.returns.columns;

const COLUMNS: readonly Column<ReturnedPiece>[] = [
  { label: pieceHead, sort: (piece) => piece.piece_code },
  { label: itemHead, sort: (piece) => piece.name ?? "", choice: (piece) => piece.name ?? copy.returns.noItem },
  { label: returnedHead, sort: (piece) => piece.returned_at },
  { label: handedHead, sort: (piece) => piece.handed_in_to ?? "" },
  { label: warrantyHead, sort: (piece) => piece.warranty_ends_on ?? "" },
];

export function ReturnedPieces({
  pieces,
  onAnswer,
}: {
  pieces: readonly ReturnedPiece[];
  onAnswer: (answer: ClaimAnswer, said: string) => void;
}) {
  const access = useAccess();
  const view = useTableView(pieces, COLUMNS, { search: (piece) => `${piece.piece_code} ${piece.name ?? ""}` });
  if (pieces.length === 0) return <EmptyState look="panel" line={copy.returns.none} />;
  const claim = async (piece: ReturnedPiece) => {
    onAnswer(await purchasingApi.claimReturned(piece.id), copy.returns.claimed);
  };
  return (
    <>
      <Narrowing view={view} label={copy.returns.find} />
      <Table>
        <thead>
          <tr>
            <SortHeads view={view} />
            <th scope="col">
              <VisuallyHidden>{copy.returns.settle}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {view.shown.map((piece) => (
            <tr key={piece.id}>
              <RowHead>{piece.piece_code}</RowHead>
              <td>{piece.name ?? <NoValue />}</td>
              <td>{shortDate(indiaDate(piece.returned_at))}</td>
              <td>{piece.handed_in_to ?? <NoValue />}</td>
              <td>{warrantyOf(piece)}</td>
              <td className={ACTIONS}>
                <RowActions>
                  {piece.in_warranty && access.mayCall("POST /api/returned-pieces/{id}/claim") && (
                    <RowButton aria-label={copy.returns.claimLabel(piece.piece_code)} onClick={() => void claim(piece)}>
                      {copy.returns.claim}
                    </RowButton>
                  )}
                  {access.mayCall("POST /api/returned-pieces/{id}/write-off") && (
                    <WriteOff piece={piece} onAnswer={onAnswer} />
                  )}
                </RowActions>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <TableEnd view={view} />
    </>
  );
}
