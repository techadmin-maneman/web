// The piece step's parts (./Piece.tsx): a one visit's choice, what the client paid for, the hair system from the kit,
// the label with its lookup and the client's pieces to pick from, the base and the lot, and on a replacement the piece
// that came off.

import { GLYPHS } from "@maneman/brand/icons";
import { Field, TextInput, type FieldControl } from "@maneman/ui/Field";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { QrCamera } from "@maneman/ui/ScanField";
import { useState, type ReactNode } from "react";
import type { Job, PieceLookup } from "../api.ts";
import { job as jobCopy, oneVisit, steps as copy } from "../content.ts";
import { paidFor, profileNamesAnother } from "../lib/paid-for.ts";
import { dayMonth } from "../lib/when.ts";
import { asLabel, isLabel } from "./label.ts";
import { DECLINED, given, type Choice, type ClientPiece, type KitHairSystem } from "./piece-form.ts";
import shared from "./steps.module.css";
import styles from "./piece-fields.module.css";

export type Looked =
  | { readonly state: "none" }
  | { readonly state: "unknown" }
  | { readonly state: "offline" }
  | { readonly state: "found"; readonly found: PieceLookup };

export const NOT_LOOKED: Looked = { state: "none" };

/** A field on the ink, labelled as the technician board labels its boxes. */
function InkField(props: { label: string; children: (control: FieldControl) => ReactNode }) {
  return (
    <Field onInk label={props.label} look={{ label: shared.fieldLabel }}>
      {props.children}
    </Field>
  );
}
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
    <section className={shared.field} aria-labelledby="client-choice-title">
      <h2 className={capsLook(shared.fieldTitle)} id="client-choice-title">
        {oneVisit.choice}
      </h2>
      {products.length === 0 && <p className={shared.note}>{oneVisit.noProducts}</p>}
      <div className={shared.choiceList}>
        {options.map((option) => (
          <ToggleButton
            key={option.id}
            onInk
            className={shared.choice}
            pressed={choice === option.id}
            onClick={() => {
              onChoose(option.id);
            }}
          >
            {option.label}
          </ToggleButton>
        ))}
      </div>
      {choice === DECLINED && <p className={shared.note}>{oneVisit.declinedNote}</p>}
    </section>
  );
}

/**
 * The hair systems the kit holds, those made to the client's profile first and marked so: one tap picks the one fitted,
 * which comes out of the kit, and a second tap leaves it for a piece from elsewhere. A kit holding none shows nothing.
 */
export function KitPieces({
  choices,
  stock,
  onStock,
}: {
  choices: readonly { readonly hairSystem: KitHairSystem; readonly matches: boolean }[];
  stock: string | null;
  onStock: (stock: string | null) => void;
}) {
  if (choices.length === 0) return null;
  return (
    <section className={shared.field} aria-labelledby="kit-pieces-title">
      <h2 className={capsLook(shared.fieldTitle)} id="kit-pieces-title">
        {copy.piece.kit.title}
      </h2>
      <div className={shared.choiceList}>
        {choices.map(({ hairSystem, matches }) => (
          <ToggleButton
            key={hairSystem.code}
            onInk
            className={shared.choice}
            pressed={stock === hairSystem.code}
            onClick={() => {
              onStock(stock === hairSystem.code ? null : hairSystem.code);
            }}
          >
            {hairSystem.name} · {copy.piece.kit.held(hairSystem.held)}
            {matches && <span className={shared.note}> · {copy.piece.kit.matches}</span>}
          </ToggleButton>
        ))}
      </div>
    </section>
  );
}

/** What the client paid for, which is what they fit, and a warning when the hair profile names another product. */
export function PaidFor({ job }: { job: Job }) {
  const paid = paidFor(job);
  if (paid === null) return null;
  const inProfile = profileNamesAnother(job);
  return (
    <section className={shared.field} aria-labelledby="paid-for-title">
      <h2 className={capsLook(shared.fieldTitle)} id="paid-for-title">
        {jobCopy.piece.rows.paidFor}
      </h2>
      <p className={shared.paidFor}>{paid}</p>
      {inProfile !== null && (
        <p className={shared.hint} role="alert">
          {jobCopy.piece.mismatch(inProfile)}
        </p>
      )}
    </section>
  );
}

function PieceList({ pieces, onPick }: { pieces: readonly ClientPiece[]; onPick: (piece: ClientPiece) => void }) {
  return (
    <ul className={shared.picks}>
      {pieces.map((piece) => (
        <li key={piece.piece_code}>
          <Button
            variant="outlineOnInk"
            size="control"
            className={shared.pick}
            onClick={() => {
              onPick(piece);
            }}
          >
            {copy.piece.listed(piece.piece_code, piece.fitted_at === null ? null : dayMonth(piece.fitted_at))}
          </Button>
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
        className={shared.second}
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        {copy.piece.pick}
      </Button>
      {props.open && <PieceList pieces={props.pieces} onPick={props.onPick} />}
    </>
  );
}

/** "Scan the label": the camera, open until it reads a label, which goes in the box. */
function ScanButton({ onCode }: { onCode: (code: string) => void }) {
  const [scanning, setScanning] = useState(false);
  return (
    <>
      <Button
        variant="outlineOnInk"
        size="control"
        className={shared.second}
        aria-pressed={scanning}
        onClick={() => {
          setScanning(!scanning);
        }}
      >
        {scanning ? copy.piece.stopScan : copy.piece.scan}
      </Button>
      {scanning && (
        <QrCamera
          words={copy.piece.camera}
          onRead={(text) => {
            setScanning(false);
            onCode(asLabel(text));
          }}
        />
      )}
    </>
  );
}

/** The new piece's label: typed, checked against the format, looked up, or picked; and what the lookup found. */
export function LabelField(props: {
  code: string;
  looked: Looked;
  looking: boolean;
  /** What the label warns of (piece-form's labelWarning); null for nothing. */
  warning: string | null;
  pieces: readonly ClientPiece[];
  picking: boolean;
  onCode: (code: string) => void;
  onLook: () => void;
  onTogglePicking: () => void;
  onPick: (piece: ClientPiece) => void;
}) {
  const { code } = props;
  const malformed = given(code) && !isLabel(code);
  return (
    <>
      <div className={shared.field}>
        <Field
          onInk
          label={copy.piece.label}
          error={malformed ? copy.piece.malformed : null}
          look={{ label: shared.fieldLabel, error: shared.hint }}
        >
          {(control) => (
            <TextInput
              {...control}
              onInk
              icon={GLYPHS.tag}
              className={styles.labelInput}
              value={code}
              placeholder={copy.piece.placeholder}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                props.onCode(asLabel(event.target.value));
              }}
            />
          )}
        </Field>
        <ScanButton onCode={props.onCode} />
        <Button
          variant="outlineOnInk"
          size="control"
          className={shared.second}
          disabled={!isLabel(code) || props.looking}
          busy={props.looking}
          onClick={props.onLook}
        >
          {copy.piece.look}
        </Button>
        <Picker pieces={props.pieces} open={props.picking} onToggle={props.onTogglePicking} onPick={props.onPick} />
      </div>
      {props.warning !== null && (
        <p className={shared.warn} role="alert">
          {props.warning}
        </p>
      )}
      <LookedNote looked={props.looked} />
    </>
  );
}

/** What the label's lookup found, beneath the box: nothing, a unit from the kit, another client's piece, or no answer. */
function LookedNote({ looked }: { looked: Looked }) {
  if (looked.state === "unknown" || looked.state === "offline") {
    return (
      <p className={shared.note} role="status">
        {looked.state === "unknown" ? copy.piece.unknown : copy.piece.offline}
      </p>
    );
  }
  if (looked.state !== "found") return null;
  const { found } = looked;
  if (found.in_kit) {
    return (
      <p className={shared.note} role="status">
        {copy.piece.inKit(found.piece.base ?? found.piece.piece_code, found.piece.supplier_lot)}
      </p>
    );
  }
  if (found.belongs_to_this_job) return null;
  return (
    <p className={shared.warn} role="alert">
      {copy.piece.notThisClient}
    </p>
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
    <div className={shared.field}>
      <InkField label={copy.piece.base}>
        {(control) => (
          <TextInput
            {...control}
            onInk
            className={shared.box64}
            value={props.base}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              props.onBase(event.target.value);
            }}
          />
        )}
      </InkField>
      <InkField label={copy.piece.lot}>
        {(control) => (
          <TextInput
            {...control}
            onInk
            className={shared.box64}
            value={props.lot}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              props.onLot(event.target.value);
            }}
          />
        )}
      </InkField>
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
    <section className={shared.field} aria-labelledby="old-piece-title">
      <h2 className={capsLook(shared.fieldTitle)} id="old-piece-title">
        {copy.piece.old.title}
      </h2>
      <InkField label={copy.piece.old.label}>
        {(control) => (
          <TextInput
            {...control}
            onInk
            className={shared.box64}
            value={props.code}
            placeholder={copy.piece.placeholder}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              props.onCode(asLabel(event.target.value));
            }}
          />
        )}
      </InkField>
      <Picker pieces={props.pieces} open={props.picking} onToggle={props.onTogglePicking} onPick={props.onPick} />
      <InkField label={copy.piece.old.reason}>
        {(control) => (
          <TextInput
            {...control}
            onInk
            className={shared.box64}
            value={props.reason}
            autoComplete="off"
            onChange={(event) => {
              props.onReason(event.target.value);
            }}
          />
        )}
      </InkField>
    </section>
  );
}
