// One of a few to choose, drawn as a card whose words are the screen's: a service and its price, a card to share.
// The radio is the browser's, unseen, over the whole card, so the card is what is tapped and the keyboard and a screen
// reader work as they do with any radio. `filled` turns the card to the ink when chosen; `ticked` edges it in the ink
// and the screen draws a `TickBox` in it; `picture` stands a drawing or a photograph over its words and edges it in
// the ink. On the ink, a chosen card is edged in the paper.

import { GLYPHS } from "@maneman/brand/icons";
import type { ChangeEvent, ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import { classes } from "./classes.ts";
import styles from "./choice-card.module.css";

export function ChoiceCard({
  name,
  checked,
  disabled,
  look = "filled",
  onInk = false,
  className,
  onChange,
  children,
}: {
  readonly name: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly look?: "filled" | "ticked" | "picture";
  readonly onInk?: boolean;
  readonly className?: string | undefined;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly children: ReactNode;
}) {
  return (
    <label className={classes(styles.card, styles[look], onInk && styles.onInk, className)}>
      <input
        className={styles.radio}
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      {children}
    </label>
  );
}

/** A ticked card's box, ticked when the card is chosen. */
export function TickBox({ checked }: { readonly checked: boolean }) {
  return (
    <span className={classes(styles.box, checked && styles.boxOn)} aria-hidden="true">
      {checked && <Icon d={GLYPHS.check} size={13} />}
    </span>
  );
}

/** The quieter words on a card, which turn lighter when a filled card is chosen. */
export const CARD_NOTE = styles.note;
