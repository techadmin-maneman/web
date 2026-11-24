// A hair system marked failed by Care, or its failure taken back (docs/decisions/0273-why-a-hair-system-failed.md), in
// the Hair systems tab's last column. Marking asks why, from the job sheet's list, and the day, in a drawer beside the
// page; the client is then owed a replacement as for one the technician recorded. Undo takes it back at once.

import { SubmitButton } from "@maneman/ui/SubmitButton";
import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { CancelButton } from "@maneman/ui/CancelButton";
import { DateInput, Field, Select } from "@maneman/ui/Field";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { Refused } from "@maneman/ui/Refusal";
import { TextButton } from "@maneman/ui/TextLink";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { apiNow } from "@maneman/web-kit/clock";
import { todayInIndia } from "@maneman/web-kit/dates";
import { FormActions } from "@maneman/ui/FormActions";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import type { Success } from "@maneman/web-kit/api";
import type { paths } from "../api-schema.ts";
import { type Piece } from "../api.ts";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import form from "@maneman/ui/forms.module.css";
import shared from "./clients.module.css";
import { clientsApi } from "./clients-api.ts";

const copy = clients.pieces.failure;

export type ClientPieces = Success<paths["/api/clients/{id}/pieces"]["get"]>;
type Reason = ClientPieces["failure_reasons"][number];

const BOXES = ["failure_reason", "failed_on"];

/** Mark failed's form, in its drawer beside the page. */
function MarkForm(props: {
  readonly clientId: string;
  readonly piece: Piece;
  readonly reasons: readonly Reason[];
  readonly onMarked: (pieces: ClientPieces) => void;
  readonly onCancel: () => void;
}) {
  const today = todayInIndia(apiNow());
  const [reason, setReason] = useState("");
  const [on, setOn] = useState(today);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, once] = useOneAtATime();
  const mark = () =>
    once(async () => {
      setFailure(null);
      const answer = await clientsApi.markPieceFailed(props.clientId, props.piece.piece_code, {
        failure_reason: reason,
        failed_on: on,
      });
      if (!answer.ok) {
        setFailure({ code: answer.code, fields: answer.fields });
        return;
      }
      props.onMarked(answer.body);
    });
  return (
    <FormDrawer title={copy.title(props.piece.piece_code)} onClose={props.onCancel}>
      <form
        className={form.fields}
        // The picker keeps to the fit and today; a day typed outside them is the API's to refuse, in our words.
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void mark();
        }}
      >
        <Field label={copy.reason} error={boxError(copy.errors, failure, "failure_reason")}>
          {(control) => (
            <Select
              {...control}
              width="choice"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            >
              <option value="" disabled>
                {copy.pickReason}
              </option>
              {props.reasons.map((each) => (
                <option key={each.code} value={each.code}>
                  {each.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={copy.failedOn} error={boxError(copy.errors, failure, "failed_on")}>
          {(control) => (
            <DateInput
              {...control}
              value={on}
              min={props.piece.fitted_at ?? undefined}
              max={today}
              onChange={(event) => {
                setOn(event.target.value);
              }}
            />
          )}
        </Field>
        <Refused failed={failure} errors={copy.errors} boxes={BOXES} />
        <FormActions>
          <SubmitButton icon={ACTION_ICONS.triangleExclamationPoint} disabled={busy || reason === "" || on === ""}>
            {busy ? copy.marking : copy.mark}
          </SubmitButton>
          <CancelButton disabled={busy} onClick={props.onCancel} />
        </FormActions>
      </form>
    </FormDrawer>
  );
}

/**
 * The Came off cell: how the piece came off, with Undo beneath a failure; for a piece in wear, Mark failed in place of
 * the dash, as a visit's code is offered, where the caller may.
 */
export function PieceFailure(props: {
  readonly clientId: string;
  readonly piece: Piece;
  readonly reasons: readonly Reason[];
  /** How it came off, as the board writes it; a dash for a piece in wear. */
  readonly said: string;
  readonly onChanged: (pieces: ClientPieces) => void;
}) {
  const { clientId, piece, reasons, onChanged } = props;
  const access = useAccess();
  const [marking, setMarking] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, once] = useOneAtATime();
  const failed = piece.failed_at !== null;
  const mayUndo = failed && access.mayCall("DELETE /api/clients/{id}/pieces/{code}/failure");
  const mayMark =
    !failed &&
    piece.fitted_at !== null &&
    reasons.length > 0 &&
    access.mayCall("POST /api/clients/{id}/pieces/{code}/failure");
  const undo = () =>
    once(async () => {
      setFailure(null);
      const answer = await clientsApi.undoPieceFailure(clientId, piece.piece_code);
      if (!answer.ok) {
        setFailure({ code: answer.code });
        return;
      }
      // Taken back: the tab is read again, as it now stands, or says why it could not be.
      const now = await clientsApi.clientPieces(clientId);
      if (now.ok) onChanged(now.body);
      else setFailure({ code: now.code });
    });
  return (
    <>
      {!(mayMark && piece.replaced_at === null) && <span>{props.said}</span>}
      {mayUndo && (
        <TextButton
          icon={ACTION_ICONS.undo2}
          compact
          className={shared.rowAction}
          aria-label={copy.undoLabel(piece.piece_code)}
          disabled={busy}
          onClick={() => void undo()}
        >
          {busy ? copy.undoing : copy.undo}
        </TextButton>
      )}
      {mayMark && (
        <TextButton
          icon={ACTION_ICONS.triangleExclamationPoint}
          compact
          className={shared.rowAction}
          aria-label={copy.markLabel(piece.piece_code)}
          onClick={() => {
            setMarking(true);
          }}
        >
          {copy.mark}
        </TextButton>
      )}
      <Refused failed={failure} errors={copy.errors} />
      {marking && (
        <MarkForm
          clientId={clientId}
          piece={piece}
          reasons={reasons}
          onMarked={(pieces) => {
            setMarking(false);
            onChanged(pieces);
          }}
          onCancel={() => {
            setMarking(false);
          }}
        />
      )}
    </>
  );
}
