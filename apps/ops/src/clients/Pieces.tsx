// Board B1: every piece the client has been fitted with, in the board's own six
// columns. A piece is recorded by the technician's phone, so nothing here is
// edited (src/routes/ops/field.ts). Above them, the client's
// hair profile, which the board does not draw (./HairProfile.tsx), loaded when the tab first opens.
//
// The board sets the live piece's replacement date in brass and leaves the rest
// quiet. A piece that has failed has been replaced, so the brass falls on the
// one that has not.

import { classes } from "@maneman/ui/classes";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { fullDate, longDate } from "@maneman/web-kit/dates";
import { lazy, Suspense, useCallback } from "react";
import { api, type Piece } from "../api.ts";
import { clients } from "../content.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./clients.module.css";
import { loadOrReload } from "../lib/load-or-reload.ts";

const HairProfile = lazy(() =>
  loadOrReload(() => import("./HairProfile.tsx")).then((module) => ({ default: module.HairProfile })),
);

const copy = clients.pieces;

/** The table's columns, in the board's order. */
const COLUMNS = ["code", "base", "fitted", "lot", "due", "failure"] as const;

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
      <td className={classes(styles.due, live && styles.dueSoon)}>{dateOf(piece.replacement_due_at)}</td>
      <td className={styles.failure}>
        {piece.failed_at === null ? clients.unknown : copy.failed(longDate(piece.failed_at), piece.failure_reason)}
      </td>
    </tr>
  );
}

export function Pieces({ clientId }: { clientId: string }) {
  return (
    <>
      <Suspense fallback={<Loading />}>
        <HairProfile clientId={clientId} />
      </Suspense>
      <PieceTable clientId={clientId} />
    </>
  );
}

function PieceTable({ clientId }: { clientId: string }) {
  const load = useCallback(() => api.clientPieces(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const { pieces } = loaded.value;
  return (
    <section className={styles.pieces} aria-label={copy.title}>
      {pieces.length === 0 ? (
        <p className={styles.empty}>{copy.empty}</p>
      ) : (
        <Table className={styles.table}>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th key={column} scope="col" className={styles[column]}>
                  {copy.columns[column]}
                </th>
              ))}
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
