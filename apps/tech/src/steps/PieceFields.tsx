// The piece step's parts (./Piece.tsx) beside the scanner (./PieceScan.tsx): a one visit's choice, and the kit's hair
// systems whose pieces carry no labels, to pick the one fitted.

import { capsLook } from "@maneman/ui/Caps";
import { ChoiceGroup, Radio } from "@maneman/ui/Field";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import type { Job, PieceLookup } from "../api.ts";
import { oneVisit, steps as copy } from "../content.ts";
import { sayKnown } from "../lang/index.ts";
import { When } from "./FitWhen.tsx";
import { DECLINED, type Choice, type KitHairSystem } from "./piece-form.ts";
import shared from "./steps.module.css";
import scan from "./piece-scan.module.css";

export type Looked =
  | { readonly state: "none" }
  | { readonly state: "unknown" }
  | { readonly state: "offline" }
  | { readonly state: "found"; readonly found: PieceLookup };

export const NOT_LOOKED: Looked = { state: "none" };

/**
 * The products the client may choose, by name, and the choice against the fit: one tap each. A product chosen asks
 * when it is fitted: today, or another day ops book.
 */
export function ChoiceList({
  products,
  choice,
  later,
  canFitToday,
  onChoose,
  onLater,
}: {
  products: Job["products"];
  choice: Choice;
  later: boolean;
  /** Whether the kit holds the hair system chosen, which a fit today needs. */
  canFitToday: boolean;
  onChoose: (choice: string) => void;
  onLater: (later: boolean) => void;
}) {
  const options = [
    ...products.map((product) => ({ id: product.tier, label: product.name })),
    { id: DECLINED, label: oneVisit.declined },
  ];
  return (
    <>
      {/* The client's choice as radio rows, as the prototype draws it. */}
      <div className={shared.field}>
        <ChoiceGroup legend={oneVisit.choice} legendLook="caps" ruled>
          {options.map((option) => (
            <Radio
              key={option.id}
              name="client-choice"
              label={sayKnown(option.label)}
              checked={choice === option.id}
              onChange={() => {
                onChoose(option.id);
              }}
            />
          ))}
        </ChoiceGroup>
        {products.length === 0 && <p className={shared.ruledNote}>{oneVisit.noProducts}</p>}
        {choice === DECLINED && <p className={shared.ruledNote}>{oneVisit.declinedNote}</p>}
      </div>
      {choice !== null && choice !== DECLINED && (
        <When
          product={products.find((product) => product.tier === choice)?.name ?? choice}
          canFitToday={canFitToday}
          later={later}
          onLater={onLater}
        />
      )}
    </>
  );
}

type KitChoice = { readonly hairSystem: KitHairSystem; readonly matches: boolean };

/**
 * The kit's hair systems as radio rows, one of which is the piece fitted with no label to read; beneath them, so the
 * rows never move under the finger, a warning of one picked that is not this fit's.
 */
function KitPick(props: {
  readonly choices: readonly KitChoice[];
  readonly stock: string | null;
  readonly warning: string | null;
  readonly onStock: (stock: string) => void;
}) {
  return (
    <div className={shared.field}>
      <ChoiceGroup legend={copy.piece.kit.title} legendLook="caps" ruled>
        {props.choices.map(({ hairSystem, matches }) => (
          <Radio
            key={hairSystem.code}
            name="kit-piece"
            label={`${hairSystem.name} · ${copy.piece.kit.held(hairSystem.held)}`}
            detail={matches ? copy.piece.kit.matches : undefined}
            checked={props.stock === hairSystem.code}
            onChange={() => {
              props.onStock(hairSystem.code);
            }}
          />
        ))}
      </ChoiceGroup>
      {props.warning !== null && (
        <p className={scan.warn} role="alert">
          {props.warning}
        </p>
      )}
    </div>
  );
}

/**
 * The hair systems the kit holds, those made to the client's profile first and marked so: one tap picks the one fitted,
 * which comes out of the kit, and a second tap leaves it for a piece from elsewhere. Where the piece has no label to
 * read, `pick`, the one fitted is one of these, a choice of one. A kit holding none shows nothing.
 */
export function KitPieces({
  choices,
  stock,
  pick = false,
  warning = null,
  onStock,
}: {
  choices: readonly KitChoice[];
  stock: string | null;
  pick?: boolean;
  /** Under a pick, what it warns of (piece-form's labelWarning); null for nothing. */
  warning?: string | null;
  onStock: (stock: string | null) => void;
}) {
  if (choices.length === 0) return null;
  if (pick) return <KitPick choices={choices} stock={stock} warning={warning} onStock={onStock} />;
  return (
    <section className={shared.field} aria-labelledby="kit-pieces-title">
      <h2 className={capsLook(shared.fieldTitle)} id="kit-pieces-title">
        {copy.piece.kit.title}
      </h2>
      <div className={shared.choiceList}>
        {choices.map(({ hairSystem, matches }) => (
          <ToggleButton
            key={hairSystem.code}
            className={shared.choice}
            pressed={stock === hairSystem.code}
            onClick={() => {
              onStock(stock === hairSystem.code ? null : hairSystem.code);
            }}
          >
            {/* The one made to the client's profile says so first, before the strings of figures that set it apart. */}
            {matches && <span className={shared.note}>{copy.piece.kit.matches} · </span>}
            {hairSystem.name} · {copy.piece.kit.held(hairSystem.held)}
          </ToggleButton>
        ))}
      </div>
    </section>
  );
}
