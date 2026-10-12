// Returned pieces handed in, to settle (docs/decisions/0169-supplier-claims.md): each with its supplier's warranty,
// claimed while inside it, or written off with why.

import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { client } from "../api.ts";
import { purchasing as copy } from "../content/purchasing.ts";
import form from "../components/forms.module.css";
import { useAccess } from "../lib/access.ts";
import type { ClaimAnswer } from "./ClaimSteps.tsx";
import { StockPhoto } from "./StockPhoto.tsx";
import type { ReturnedPiece } from "./types.ts";

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
      <div className={form.actions}>
        <Button
          variant="destructive"
          size="small"
          disabled={reason.trim() === "" || photoId === null}
          onClick={() =>
            void client
              .post("/api/returned-pieces/{id}/write-off", {
                path: { id: piece.id },
                body: { reason: reason.trim(), photo_id: photoId ?? "" },
              })
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
      </div>
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
  if (pieces.length === 0) return <p className={form.note}>{copy.returns.none}</p>;
  const claim = async (piece: ReturnedPiece) => {
    onAnswer(await client.post("/api/returned-pieces/{id}/claim", { path: { id: piece.id } }), copy.returns.claimed);
  };
  return (
    <Table className={form.table}>
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
            <th scope="row" className={form.rowHead}>
              {piece.piece_code}
            </th>
            <td>{piece.name ?? ""}</td>
            <td>{shortDate(indiaDate(piece.returned_at))}</td>
            <td>{piece.handed_in_to ?? ""}</td>
            <td>{warrantyOf(piece)}</td>
            <td>
              <div className={form.actions}>
                {piece.in_warranty && access.mayCall("POST /api/returned-pieces/{id}/claim") && (
                  <Button variant="primary" size="small" onClick={() => void claim(piece)}>
                    {copy.returns.claim}
                  </Button>
                )}
                {access.mayCall("POST /api/returned-pieces/{id}/write-off") && (
                  <WriteOff piece={piece} onAnswer={onAnswer} />
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
