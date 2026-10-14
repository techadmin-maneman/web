// Every piece the client has been fitted with, read only, since the technician's phone records them
// (src/routes/ops/client-pieces.ts). Above them the hair profile (./HairProfile.tsx), the stock it matches
// (./StockMatch.tsx) and custom orders (./CustomOrders.tsx), each loaded when the tab first opens. Only the live
// piece's replacement date is in brass.

import { EmptyState } from "@maneman/ui/EmptyState";
import { lazyScreen } from "@maneman/ui/lazyScreen";
import { classes } from "@maneman/ui/classes";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { fullDate, longDate } from "@maneman/web-kit/dates";
import { Suspense, useCallback } from "react";
import { type Piece } from "../api.ts";
import { clients } from "../content.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./clients.module.css";
import { clientsApi } from "./clients-api.ts";

const HairProfile = lazyScreen(() => import("./HairProfile.tsx").then((module) => module.HairProfile));

const StockMatch = lazyScreen(() => import("./StockMatch.tsx").then((module) => module.StockMatch));

const CustomOrders = lazyScreen(() => import("./CustomOrders.tsx").then((module) => module.CustomOrders));

const copy = clients.pieces;

/** The table's columns, in the board's order. */
const COLUMNS = ["code", "base", "fitted", "lot", "due", "failure"] as const;

const dateOf = (isoDate: string | null) => (isoDate === null ? clients.unknown : fullDate(isoDate));

function cameOff(piece: Piece): string {
  if (piece.failed_at !== null) return copy.failed(longDate(piece.failed_at), piece.failure_reason);
  return piece.replaced_at === null ? clients.unknown : copy.replaced(longDate(piece.replaced_at));
}

function PieceRow({ piece }: { piece: Piece }) {
  const live = piece.failed_at === null && piece.replaced_at === null;
  return (
    <tr>
      <th scope="row" className={styles.code}>
        {piece.piece_code}
      </th>
      <td className={styles.base}>{piece.base ?? clients.unknown}</td>
      <td className={styles.fitted}>{dateOf(piece.fitted_at)}</td>
      <td className={styles.lot}>{piece.supplier_lot ?? clients.unknown}</td>
      <td className={classes(styles.due, live && styles.dueSoon)}>{dateOf(piece.replacement_due_at)}</td>
      <td className={styles.failure}>{cameOff(piece)}</td>
    </tr>
  );
}

export function Pieces({ clientId }: { clientId: string }) {
  return (
    <>
      <Suspense fallback={<Loading />}>
        <HairProfile clientId={clientId} />
        <StockMatch clientId={clientId} />
        <CustomOrders clientId={clientId} />
      </Suspense>
      <PieceTable clientId={clientId} />
    </>
  );
}

function PieceTable({ clientId }: { clientId: string }) {
  const load = useCallback(() => clientsApi.clientPieces(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const { pieces } = loaded.value;
  return (
    <section aria-label={copy.title}>
      {pieces.length === 0 ? (
        <EmptyState look="panel" line={copy.empty} />
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
