// A way to pick photographs from the phone: the browser's file chooser, unseen, inside what the screen draws for it,
// as a dashed tile with a plus or as words that act. The tile or the words take the chooser's focus ring.
//
//   <PhotoPick look="tile" label="Add photos" multiple onPick={add}><Icon d={ICONS.plus} size="md" /></PhotoPick>

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./photo-pick.module.css";

export function PhotoPick({
  look,
  label,
  multiple = false,
  disabled = false,
  className,
  onPick,
  children,
}: {
  /** A tile beside the photographs picked, or words among other words. */
  readonly look: "tile" | "words";
  /** What it does, for a screen reader: "Add photos". */
  readonly label: string;
  readonly multiple?: boolean;
  readonly disabled?: boolean;
  readonly className?: string | undefined;
  readonly onPick: (files: readonly File[]) => void;
  readonly children: ReactNode;
}) {
  return (
    <label className={classes(look === "tile" ? styles.tile : styles.words, className)} aria-disabled={disabled}>
      {children}
      <input
        className={styles.file}
        type="file"
        accept="image/*"
        multiple={multiple}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          onPick([...(event.currentTarget.files ?? [])]);
          // So the same photograph can be picked again after it was taken out.
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}
