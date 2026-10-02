// Board B1: every piece the client has been fitted with, in the board's own six
// columns. FSM owns the asset, and the route reads it afresh before it answers,
// so nothing here is edited (src/routes/ops-field.ts). Above them, the client's
// hair profile, which the board does not draw (./HairProfile.tsx).
//
// The board sets the live piece's replacement date in brass and leaves the rest
// quiet. A piece that has failed has been replaced, so the brass falls on the
// one that has not.

import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { fullDate, longDate } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import { api, type Piece } from "../api.ts";
import { clients } from "../content.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./clients.module.css";
import { HairProfile } from "./HairProfile.tsx";

const copy = clients.pieces;

const dateOf = (isoDate: string | null) => (isoDate === null ? clients.unknown : fullDate(isoDate));

function PieceRow({ piece }: { piece: Piece }) {
  const live = piece.failed_at === null;
  return (
    <tr>
      <th scope="row" className={styles.code}>
        {piece.piece_code}
      </th>
      <td className={styles.base}>{piece.base ?? clients.unknown}</td>
      <td className={styles.fitted}>{dateOf(piece.fitted_at)}</td>
      <td className={styles.lot}>{piece.supplier_lot ?? clients.unknown}</td>
      <td className={`${styles.due ?? ""} ${live ? (styles.dueSoon ?? "") : ""}`}>
        {dateOf(piece.replacement_due_at)}
      </td>
      <td className={styles.failure}>
        {piece.failed_at === null ? clients.unknown : copy.failed(longDate(piece.failed_at), piece.failure_reason)}
      </td>
    </tr>
  );
}

export function Pieces({ clientId }: { clientId: string }) {
  return (
    <>
      <HairProfile clientId={clientId} />
      <PieceTable clientId={clientId} />
    </>
  );
}

function PieceTable({ clientId }: { clientId: string }) {
  const load = useCallback(() => api.clientPieces(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  const { pieces } = loaded.value;
  return (
    <section className={styles.pieces} aria-label={copy.title}>
      {pieces.length === 0 ? (
        <p className={styles.empty}>{copy.empty}</p>
      ) : (
        <Table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.code}>
                {copy.columns[0]}
              </th>
              <th scope="col" className={styles.base}>
                {copy.columns[1]}
              </th>
              <th scope="col" className={styles.fitted}>
                {copy.columns[2]}
              </th>
              <th scope="col" className={styles.lot}>
                {copy.columns[3]}
              </th>
              <th scope="col" className={styles.due}>
                {copy.columns[4]}
              </th>
              <th scope="col" className={styles.failure}>
                {copy.columns[5]}
              </th>
            </tr>
          </thead>
          <tbody>
            {pieces.map((piece) => (
              <PieceRow key={piece.piece_code} piece={piece} />
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
