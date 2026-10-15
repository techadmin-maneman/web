// Returned pieces handed in, to settle (docs/decisions/0169-supplier-claims.md): each with its supplier's warranty,
// claimed while inside it, or written off with why.

import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Table } from "@maneman/ui/Table";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import { useAccess } from "../lib/access.ts";
import type { ClaimAnswer } from "./ClaimSteps.tsx";
import { StockPhoto } from "./StockPhoto.tsx";
import type { ReturnedPiece } from "./types.ts";
import { RowHead } from "../components/RowHead.tsx";
import { FormActions } from "../components/FormActions.tsx";
import { purchasingApi } from "./purchasing-api.ts";

function warrantyOf(piece: ReturnedPiece): string {
  if (piece.warranty_ends_on === null) return copy.returns.unknown;
  const day = shortDate(piece.warranty_ends_on);
  return piece.in_warranty ? copy.returns.until(day) : copy.returns.ended(day);
}

function WriteOff({
  piece,
  onAnswer,
}: {
  piece: ReturnedPiece;
  onAnswer: (answer: ClaimAnswer, said: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button
        variant="outline"
        size="small"
        onClick={() => {
          setOpen(true);
        }}
      >
        {copy.returns.writeOff}
      </Button>
    );
  }
  return (
    <div className={form.group}>
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
        <Button
          variant="outline"
          size="small"
          onClick={() => {
            setOpen(false);
          }}
        >
          {copy.returns.keep}
        </Button>
      </FormActions>
    </div>
  );
}

export function ReturnedPieces({
  pieces,
  onAnswer,
}: {
  pieces: readonly ReturnedPiece[];
  onAnswer: (answer: ClaimAnswer, said: string) => void;
}) {
  const access = useAccess();
  if (pieces.length === 0) return <Note>{copy.returns.none}</Note>;
  const claim = async (piece: ReturnedPiece) => {
    onAnswer(await purchasingApi.claimReturned(piece.id), copy.returns.claimed);
  };
  return (
    <Table controls>
      <thead>
        <tr>
          {copy.returns.columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {pieces.map((piece) => (
          <tr key={piece.id}>
            <RowHead>{piece.piece_code}</RowHead>
            <td>{piece.name ?? ""}</td>
            <td>{shortDate(indiaDate(piece.returned_at))}</td>
            <td>{piece.handed_in_to ?? ""}</td>
            <td>{warrantyOf(piece)}</td>
            <td>
              <FormActions>
                {piece.in_warranty && access.mayCall("POST /api/returned-pieces/{id}/claim") && (
                  <Button variant="primary" size="small" onClick={() => void claim(piece)}>
                    {copy.returns.claim}
                  </Button>
                )}
                {access.mayCall("POST /api/returned-pieces/{id}/write-off") && (
                  <WriteOff piece={piece} onAnswer={onAnswer} />
                )}
              </FormActions>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
