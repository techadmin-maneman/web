// The piece step's parts (./Piece.tsx): a one visit's choice, what the client paid for, the label with its lookup and
// the client's pieces to pick from, the base and the lot, and on a replacement the piece that came off.

import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import type { Job, PieceLookup } from "../api.ts";
import { job as jobCopy, oneVisit, steps as copy } from "../content.ts";
import { STROKE, TAG } from "../icons.ts";
import { paidFor, profileNamesAnother } from "../lib/paid-for.ts";
import { dayMonth } from "../lib/when.ts";
import { asLabel, isLabel } from "./label.ts";
import { DECLINED, given, type Choice, type ClientPiece } from "./piece-form.ts";
import styles from "./steps.module.css";

export type Looked =
  | { readonly state: "none" }
  | { readonly state: "unknown" }
  | { readonly state: "offline" }
  | { readonly state: "found"; readonly found: PieceLookup };

export const NOT_LOOKED: Looked = { state: "none" };

/** The products the client may choose, by name, and the choice against the fit: one tap each. */
export function ChoiceList({
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
      <h2 className={capsLook(styles.fieldTitle)} id="client-choice-title">
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

/** What the client paid for, which is what he fits, and a warning when the hair profile names another product. */
export function PaidFor({ job }: { job: Job }) {
  const paid = paidFor(job);
  if (paid === null) return null;
  const inProfile = profileNamesAnother(job);
  return (
    <section className={styles.field} aria-labelledby="paid-for-title">
      <h2 className={capsLook(styles.fieldTitle)} id="paid-for-title">
        {jobCopy.piece.rows.paidFor}
      </h2>
      <p className={styles.paidFor}>{paid}</p>
      {inProfile !== null && (
        <p className={styles.hint} role="alert">
          {jobCopy.piece.mismatch(inProfile)}
        </p>
      )}
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

/** Pick from the client's pieces: the button that opens the list, and the list once open. */
function Picker(props: {
  pieces: readonly ClientPiece[];
  open: boolean;
  onToggle: () => void;
  onPick: (piece: ClientPiece) => void;
}) {
  if (props.pieces.length === 0) return null;
  return (
    <>
      <Button
        variant="outlineOnInk"
        size="control"
        className={styles.second}
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        {copy.piece.pick}
      </Button>
      {props.open && <PieceList pieces={props.pieces} onPick={props.onPick} />}
    </>
  );
}

/** The new piece's label: typed, checked against the format, looked up, or picked; and what the lookup found. */
export function LabelField(props: {
  code: string;
  looked: Looked;
  looking: boolean;
  pieces: readonly ClientPiece[];
  picking: boolean;
  onCode: (code: string) => void;
  onLook: () => void;
  onTogglePicking: () => void;
  onPick: (piece: ClientPiece) => void;
}) {
  const { code, looked } = props;
  const malformed = given(code) && !isLabel(code);
  return (
    <>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="piece-code">
          {copy.piece.label}
        </label>
        <div className={styles.labelField}>
          <Icon className={styles.labelIcon} d={TAG} size={21} stroke={STROKE} />
          <input
            className={styles.input}
            id="piece-code"
            value={code}
            placeholder={copy.piece.placeholder}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={malformed ? "piece-code-format" : undefined}
            onChange={(event) => {
              props.onCode(asLabel(event.target.value));
            }}
          />
        </div>
        {malformed && (
          <p className={styles.hint} id="piece-code-format">
            {copy.piece.malformed}
          </p>
        )}
        <Button
          variant="outlineOnInk"
          size="control"
          className={styles.second}
          disabled={!isLabel(code) || props.looking}
          busy={props.looking}
          onClick={props.onLook}
        >
          {copy.piece.look}
        </Button>
        <Picker pieces={props.pieces} open={props.picking} onToggle={props.onTogglePicking} onPick={props.onPick} />
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
      {looked.state === "found" && !looked.found.belongs_to_this_job && (
        <p className={styles.warn} role="alert">
          {copy.piece.notThisClient}
        </p>
      )}
    </>
  );
}

/** The piece's base and its supplier's lot, which a lookup fills in when it knows them. */
export function BaseAndLot(props: {
  base: string;
  lot: string;
  onBase: (base: string) => void;
  onLot: (lot: string) => void;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor="piece-base">
        {copy.piece.base}
      </label>
      <input
        className={styles.box64}
        id="piece-base"
        value={props.base}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          props.onBase(event.target.value);
        }}
      />
      <label className={styles.fieldLabel} htmlFor="piece-lot">
        {copy.piece.lot}
      </label>
      <input
        className={styles.box64}
        id="piece-lot"
        value={props.lot}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          props.onLot(event.target.value);
        }}
      />
    </div>
  );
}

/** On a replacement, the piece that came off: its label, typed or picked, and why it failed. */
export function OldPiece(props: {
  code: string;
  reason: string;
  pieces: readonly ClientPiece[];
  picking: boolean;
  onCode: (code: string) => void;
  onReason: (reason: string) => void;
  onTogglePicking: () => void;
  onPick: (piece: ClientPiece) => void;
}) {
  return (
    <section className={styles.field} aria-labelledby="old-piece-title">
      <h2 className={capsLook(styles.fieldTitle)} id="old-piece-title">
        {copy.piece.old.title}
      </h2>
      <label className={styles.fieldLabel} htmlFor="old-piece-code">
        {copy.piece.old.label}
      </label>
      <input
        className={styles.box64}
        id="old-piece-code"
        value={props.code}
        placeholder={copy.piece.placeholder}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          props.onCode(asLabel(event.target.value));
        }}
      />
      <Picker pieces={props.pieces} open={props.picking} onToggle={props.onTogglePicking} onPick={props.onPick} />
      <label className={styles.fieldLabel} htmlFor="old-piece-reason">
        {copy.piece.old.reason}
      </label>
      <input
        className={styles.box64}
        id="old-piece-reason"
        value={props.reason}
        autoComplete="off"
        onChange={(event) => {
          props.onReason(event.target.value);
        }}
      />
    </section>
  );
}
