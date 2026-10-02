// Board B3, step 4: the piece. A replacement's and a first fit's step only —
// the API leaves it out of the other types' `steps`, so this screen is never
// reached for them.
//
// A consultation and fit in one visit asks first for the client's choice, which
// no board draws: the product they chose, by name and never by price, or that
// they decided against the fit, when nothing is fitted and no label is asked for
// (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
//
// The board draws "Scan the piece". The owner ruled on 24 September 2026 that
// labels carry neither a barcode nor a QR code (docs/open-points.md, "Piece
// labels"), so the label is typed, or picked from the client's pieces the card
// carries, and checked against the API's format before Next will take it. A
// check against the mirror needs signal; a label the mirror does not know, or
// one checked with none, still goes on the job as the technician entered it.
//
// The pieces tab keeps each piece's base and supplier lot, and on a
// replacement the piece that came off and why it failed, so the step asks for
// them: a lookup fills the base and lot in when it knows them.

import { ICONS_P2 } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { api, unreachable, type Job, type PieceLookup } from "../api.ts";
import { job as jobCopy, oneVisit, steps as copy } from "../content.ts";
import { STROKE } from "../icons.ts";
import { dayMonth } from "../lib/when.ts";
import { Failed, Loading } from "../states/States.tsx";
import { asLabel, isLabel } from "./label.ts";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";
import styles from "./steps.module.css";

type ClientPiece = NonNullable<Job["pieces"]>[number];

type Looked =
  | { readonly state: "none" }
  | { readonly state: "unknown" }
  | { readonly state: "offline" }
  | { readonly state: "found"; readonly found: PieceLookup };

const NOT_LOOKED: Looked = { state: "none" };

/** The choice against the fit, beside the products' tiers. */
const DECLINED = "declined";

/** A one visit's choice: a product's tier, DECLINED, or none made yet. */
type Choice = string | null;

const given = (text: string): boolean => text.trim() !== "";

/** A piece still to be fitted, which is the new one on a first fit or a replacement. */
const toFit = (piece: ClientPiece): boolean => piece.fitted_at === null && piece.failed_at === null;
/** A piece on the client's head now, which is the one a replacement takes off. */
const onTheHead = (piece: ClientPiece): boolean => piece.fitted_at !== null && piece.failed_at === null;

/** Why the step is open again: the label the API refused, or the step as a whole. */
function noticeFor(refusedFields: readonly string[]): string {
  const aLabel = refusedFields.some((field) => field === "piece_code" || field === "old_piece");
  return aLabel ? copy.corrected.piece : copy.corrected.other;
}

/** The products the client may choose, by name, and the choice against the fit: one tap each. */
function ChoiceList({
  products,
  choice,
  onChoose,
}: {
  products: Job["products"];
  choice: Choice;
  onChoose: (choice: string) => void;
}) {
  const options = [
    ...products.map((product) => ({ id: product.tier, label: product.name })),
    { id: DECLINED, label: oneVisit.declined },
  ];
  return (
    <section className={styles.field} aria-labelledby="client-choice-title">
      <h2 className={styles.fieldTitle} id="client-choice-title">
        {oneVisit.choice}
      </h2>
      {products.length === 0 && <p className={styles.note}>{oneVisit.noProducts}</p>}
      <div className={styles.choiceList}>
        {options.map((option) => (
          <button
            key={option.id}
            className={choice === option.id ? styles.choiceOn : styles.choice}
            type="button"
            aria-pressed={choice === option.id}
            onClick={() => {
              onChoose(option.id);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      {choice === DECLINED && <p className={styles.note}>{oneVisit.declinedNote}</p>}
    </section>
  );
}

function PieceList({ pieces, onPick }: { pieces: readonly ClientPiece[]; onPick: (piece: ClientPiece) => void }) {
  return (
    <ul className={styles.picks}>
      {pieces.map((piece) => (
        <li key={piece.piece_code}>
          <button
            className={styles.pick}
            type="button"
            onClick={() => {
              onPick(piece);
            }}
          >
            {copy.piece.listed(piece.piece_code, piece.fitted_at === null ? null : dayMonth(piece.fitted_at))}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Piece({ id }: { id: string }) {
  const { loaded, retry, refused, finish, back } = useStep(id, "piece");
  const [code, setCode] = useState("");
  const [base, setBase] = useState("");
  const [lot, setLot] = useState("");
  const [looked, setLooked] = useState<Looked>(NOT_LOOKED);
  const [looking, once] = useOneAtATime();
  const [oldCode, setOldCode] = useState("");
  const [oldReason, setOldReason] = useState("");
  const [picking, setPicking] = useState<"new" | "old" | null>(null);
  const [choice, setChoice] = useState<Choice>(null);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} />;

  const job = loaded.value;
  const pieces = job.pieces ?? [];
  const takesOneOff = job.type === "replacement";
  const declined = job.one_visit && choice === DECLINED;

  const look = () =>
    once(async () => {
      const answer = await api.piece(code, id);
      if (answer.ok) {
        setLooked({ state: "found", found: answer.body });
        if (!given(base)) setBase(answer.body.piece.base ?? "");
        if (!given(lot)) setLot(answer.body.piece.supplier_lot ?? "");
        return;
      }
      setLooked(unreachable(answer) ? { state: "offline" } : { state: "unknown" });
    });

  const pickNew = (piece: ClientPiece) => {
    setCode(piece.piece_code);
    setBase(piece.base ?? "");
    setLot(piece.supplier_lot ?? "");
    setLooked({ state: "found", found: { piece, belongs_to_this_job: true } });
    setPicking(null);
  };

  const pickOld = (piece: ClientPiece) => {
    setOldCode(piece.piece_code);
    setPicking(null);
  };

  const notThisClients = looked.state === "found" && !looked.found.belongs_to_this_job;

  /** What still keeps Next dim, in the words it says instead; null once the step can go. */
  function missing(): string | null {
    if (job.one_visit && choice === null) return oneVisit.chooseFirst;
    if (declined) return null;
    if (!isLabel(code)) return copy.piece.checkFirst;
    if (notThisClients) return copy.piece.notThisClientAction;
    if (!given(oldCode)) return null;
    if (!isLabel(oldCode)) return copy.piece.checkFirst;
    return given(oldReason) ? null : copy.piece.old.needsReason;
  }

  function body(): Record<string, unknown> {
    if (declined) return { declined: true };
    const sent: Record<string, unknown> = { piece_code: code };
    if (job.one_visit && choice !== null) sent.product = choice;
    if (given(base)) sent.base = base.trim();
    if (given(lot)) sent.supplier_lot = lot.trim();
    if (given(oldCode)) sent.old_piece = { piece_code: oldCode, failure_reason: oldReason.trim() };
    return sent;
  }

  const stillMissing = missing();
  const newToPick = pieces.filter(toFit);
  const oldToPick = pieces.filter(onTheHead);

  return (
    <StepFrame
      title={copy.titles.piece}
      action={copy.next}
      ready={stillMissing === null}
      unfinished={stillMissing ?? undefined}
      notice={refused === null ? null : noticeFor(refused.fields)}
      onBack={back}
      onAction={() => void finish(body())}
    >
      {job.one_visit && <ChoiceList products={job.products} choice={choice} onChoose={setChoice} />}

      {!declined && (
        <>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="piece-code">
              {copy.piece.label}
            </label>
            <div className={styles.scan}>
              <Icon className={styles.scanIcon} d={ICONS_P2.pieceId} size={21} stroke={STROKE} />
              <input
                className={styles.input}
                id="piece-code"
                value={code}
                placeholder={copy.piece.placeholder}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-describedby={given(code) && !isLabel(code) ? "piece-code-format" : undefined}
                onChange={(event) => {
                  setCode(asLabel(event.target.value));
                  setLooked(NOT_LOOKED);
                }}
              />
            </div>
            {given(code) && !isLabel(code) && (
              <p className={styles.hint} id="piece-code-format">
                {copy.piece.malformed}
              </p>
            )}
            <Button
              variant="outlineOnInk"
              size="control"
              className={styles.second}
              disabled={!isLabel(code) || looking}
              busy={looking}
              onClick={() => void look()}
            >
              {copy.piece.look}
            </Button>
            {newToPick.length > 0 && (
              <Button
                variant="outlineOnInk"
                size="control"
                className={styles.second}
                aria-expanded={picking === "new"}
                onClick={() => {
                  setPicking(picking === "new" ? null : "new");
                }}
              >
                {copy.piece.pick}
              </Button>
            )}
            {picking === "new" && <PieceList pieces={newToPick} onPick={pickNew} />}
          </div>

          {looked.state === "unknown" && (
            <p className={styles.note} role="status">
              {copy.piece.unknown}
            </p>
          )}
          {looked.state === "offline" && (
            <p className={styles.note} role="status">
              {copy.piece.offline}
            </p>
          )}
          {notThisClients && (
            <p className={styles.warn} role="alert">
              {copy.piece.notThisClient}
            </p>
          )}

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="piece-base">
              {copy.piece.base}
            </label>
            <input
              className={styles.box64}
              id="piece-base"
              value={base}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setBase(event.target.value);
              }}
            />
            <label className={styles.fieldLabel} htmlFor="piece-lot">
              {copy.piece.lot}
            </label>
            <input
              className={styles.box64}
              id="piece-lot"
              value={lot}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setLot(event.target.value);
              }}
            />
          </div>

          {takesOneOff && (
            <section className={styles.field} aria-labelledby="old-piece-title">
              <h2 className={styles.fieldTitle} id="old-piece-title">
                {copy.piece.old.title}
              </h2>
              <label className={styles.fieldLabel} htmlFor="old-piece-code">
                {copy.piece.old.label}
              </label>
              <input
                className={styles.box64}
                id="old-piece-code"
                value={oldCode}
                placeholder={copy.piece.placeholder}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setOldCode(asLabel(event.target.value));
                }}
              />
              {oldToPick.length > 0 && (
                <Button
                  variant="outlineOnInk"
                  size="control"
                  className={styles.second}
                  aria-expanded={picking === "old"}
                  onClick={() => {
                    setPicking(picking === "old" ? null : "old");
                  }}
                >
                  {copy.piece.pick}
                </Button>
              )}
              {picking === "old" && <PieceList pieces={oldToPick} onPick={pickOld} />}
              <label className={styles.fieldLabel} htmlFor="old-piece-reason">
                {copy.piece.old.reason}
              </label>
              <input
                className={styles.box64}
                id="old-piece-reason"
                value={oldReason}
                autoComplete="off"
                onChange={(event) => {
                  setOldReason(event.target.value);
                }}
              />
            </section>
          )}
        </>
      )}
    </StepFrame>
  );
}
