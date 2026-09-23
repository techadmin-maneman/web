// Board B3, step 4: the piece. A replacement's and a first fit's step only —
// the API leaves it out of the other types' `steps`, so this screen is never
// reached for them.
//
// The board draws "Scan the piece". Labels carry no barcode yet
// (docs/open-points.md, item 25), so the code is typed and then checked against
// the mirror, which works with no signal only once it has been looked up: a
// code we do not know still goes on the job as the technician entered it.

import { useState } from "react";
import { api, type PieceLookup } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { job as jobCopy, steps as copy } from "../content.ts";
import { ICONS_P2 } from "@maneman/brand/icons";
import { Failed, Loading } from "../states/States.tsx";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";
import styles from "./steps.module.css";

type Looked =
  { readonly state: "none" } | { readonly state: "unknown" } | { readonly state: "found"; readonly found: PieceLookup };

export function Piece({ id }: { id: string }) {
  const { loaded, retry, finish, back } = useStep(id, "piece");
  const [code, setCode] = useState("");
  const [looked, setLooked] = useState<Looked>({ state: "none" });
  const [looking, setLooking] = useState(false);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} />;

  const typed = code.trim().toUpperCase();

  const look = async () => {
    setLooking(true);
    const answer = await api.piece(typed, id);
    setLooking(false);
    setLooked(answer.ok ? { state: "found", found: answer.body } : { state: "unknown" });
  };

  const piece = looked.state === "found" ? looked.found.piece : null;

  return (
    <StepFrame
      title={copy.titles.piece}
      action={copy.next}
      ready={typed.length >= 3}
      onBack={back}
      onAction={() => void finish({ piece_code: typed, base: piece?.base ?? null })}
    >
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="piece-code">
          {copy.piece.label}
        </label>
        <div className={styles.scan}>
          <Icon className={styles.scanIcon} d={ICONS_P2.pieceId} size={21} />
          <input
            className={styles.input}
            id="piece-code"
            value={code}
            placeholder={copy.piece.placeholder}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setCode(event.target.value);
              setLooked({ state: "none" });
            }}
          />
        </div>
        <button
          className={styles.second}
          type="button"
          disabled={typed.length < 3 || looking}
          onClick={() => void look()}
        >
          {copy.piece.look}
        </button>
      </div>

      {looked.state === "unknown" && (
        <p className={styles.note} role="status">
          {copy.piece.unknown}
        </p>
      )}

      {looked.state === "found" && (
        <>
          {!looked.found.belongs_to_this_job && (
            <p className={styles.warn} role="alert">
              {copy.piece.notThisClient}
            </p>
          )}
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt className={styles.rowKey}>{copy.piece.rows.piece}</dt>
              <dd className={styles.rowValue}>{looked.found.piece.piece_code}</dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.rowKey}>{copy.piece.rows.base}</dt>
              <dd className={styles.rowValue}>{looked.found.piece.base ?? copy.piece.unnamed}</dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.rowKey}>{copy.piece.rows.lot}</dt>
              <dd className={styles.rowValue}>{looked.found.piece.supplier_lot ?? copy.piece.unnamed}</dd>
            </div>
          </dl>
        </>
      )}
    </StepFrame>
  );
}
