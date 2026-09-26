// The apps' buttons, and links drawn as buttons. A look is a variant, which is
// the colours the boards draw it in, and a size, which each app sets for
// itself (./base.css): the client app's primary action is 56 px, the
// technician app's 64. A screen's own class places the button -- its margin,
// its width -- and wins over everything here (./README.md).

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, Ref } from "react";
import { classes } from "./classes.ts";
import styles from "./button.module.css";

export const BUTTON_VARIANTS = [
  /** The one action on paper: ink, with paper words. */
  "primary",
  /** The client app's one action on ink: paper, with ink words. */
  "light",
  /** The technician app's one action: gold, with ink words. */
  "gold",
  /** Any other action on paper: an ink edge. */
  "outline",
  /** Any other action on ink: a lighter ink edge, with paper words. */
  "outlineOnInk",
  /** An action that takes something away, on paper: oxblood edge and words. */
  "danger",
  /** The one that cannot be undone, as the console's deletion: oxblood, with paper words. */
  "destructive",
] as const;

export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

/** The screen's primary action, any other action, and a small one inline, such as "Try again". */
export type ButtonSize = "action" | "control" | "small";

interface Look {
  readonly variant: ButtonVariant;
  readonly size: ButtonSize;
  readonly className?: string;
}

function lookOf({ variant, size, className }: Look): string {
  return classes(styles.button, styles[variant], styles[size], className);
}

type ButtonProps = Look &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
    /** Working on what the tap asked for: said to a screen reader, and a second tap does nothing. */
    readonly busy?: boolean;
    readonly ref?: Ref<HTMLButtonElement>;
  };

export function Button({ variant, size, className, busy = false, type = "button", onClick, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={lookOf({ variant, size, className })}
      aria-busy={busy ? true : undefined}
      onClick={busy ? undefined : onClick}
    />
  );
}

type ButtonLinkProps = Look &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> & { readonly ref?: Ref<HTMLAnchorElement> };

/** A link that looks like a button: somewhere to go, such as WhatsApp or a document, rather than something to do. */
export function ButtonLink({ variant, size, className, ...rest }: ButtonLinkProps) {
  return <a {...rest} className={lookOf({ variant, size, className })} />;
}
