// A thing on a board that is itself the control: a job on the dispatch grid, a day's map, an entry in a list that opens
// it. The screen draws its look; the tile brings what every control must have: a button's behaviour, or a link's,
// the keyboard's focus ring, and no browser look of its own. An action is never a tile: it is a `Button`.

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, Ref } from "react";
import { classes } from "./classes.ts";
import styles from "./tile.module.css";

type TileProps = ButtonHTMLAttributes<HTMLButtonElement> & { readonly ref?: Ref<HTMLButtonElement> };

export function Tile({ className, type = "button", ...rest }: TileProps) {
  return <button {...rest} type={type} className={classes(styles.tile, className)} />;
}

type TileLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "target" | "rel"> & {
  /** Opened beside the app, as a document or a payment page is. */
  readonly newTab?: boolean;
  readonly ref?: Ref<HTMLAnchorElement>;
};

/** A tile that goes somewhere: an entry that opens a document, a payment page or a chat. */
export function TileLink({ className, newTab = false, children, ...rest }: TileLinkProps) {
  const beside = newTab ? { target: "_blank", rel: "noopener noreferrer" } : { rel: "noopener" };
  return (
    <a {...rest} {...beside} className={classes(styles.tile, className)}>
      {children}
    </a>
  );
}
