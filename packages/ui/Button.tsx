// The apps' buttons, and links drawn as buttons. A look is a variant, which is
// the colours the boards draw it in, and a size, which each app sets for
// itself (./base.css): the client app's primary action is 56 px, the
// technician app's 64. A screen's own class places the button -- its margin,
// its width -- and wins over everything here, so it never colours one: that
// would erase the button's states (./README.md).

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, MouseEvent, Ref } from "react";
import { classes } from "./classes.ts";
import { Icon } from "./Icon.tsx";
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

/**
 * The screen's primary action, any other action, a small one inline, such as "Try again", and a compact one inside a
 * table row, which keeps the row at its height.
 */
export type ButtonSize = "action" | "control" | "small" | "compact";

interface Look {
  readonly variant: ButtonVariant;
  readonly size: ButtonSize;
  readonly className?: string | undefined;
}

/**
 * An icon before the words, from @maneman/brand/icons: the site's sending mark, say. Given as a path rather than as a
 * child, so the site, which compiles with Preact's own types, can draw one.
 */
interface Leading {
  readonly icon?: string | undefined;
  readonly iconSize?: number;
}

/** A button's classes, for a link the app draws with its own link component, as an in-app link drawn as a button. */
export function buttonLook({ variant, size, className }: Look): string {
  return classes(styles.button, styles[variant], styles[size], className);
}

type ButtonProps = Look &
  Leading &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
    /** Working on what the tap asked for: drawn dimmed, said to a screen reader, and a second tap does nothing. */
    readonly busy?: boolean;
    readonly ref?: Ref<HTMLButtonElement>;
  };

export function Button({
  variant,
  size,
  className,
  busy = false,
  type = "button",
  icon,
  iconSize = 15,
  onClick,
  children,
  ...rest
}: ButtonProps) {
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    // Cancelled, a busy submit button does not send its form again.
    if (busy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      {...rest}
      type={type}
      className={buttonLook({ variant, size, className })}
      aria-busy={busy ? true : undefined}
      onClick={click}
    >
      {icon !== undefined && <Icon d={icon} size={iconSize} />}
      {children}
    </button>
  );
}

/** An action inside a table row, beside the row's words: compact and outlined, so the row keeps its height. */
export function RowButton(props: Omit<ButtonProps, "variant" | "size">) {
  return <Button {...props} variant="outline" size="compact" />;
}

type ButtonLinkProps = Look &
  Leading &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> & { readonly ref?: Ref<HTMLAnchorElement> };

/** A link that looks like a button: somewhere to go, such as WhatsApp or a document, rather than something to do. */
export function ButtonLink({ variant, size, className, icon, iconSize = 15, children, ...rest }: ButtonLinkProps) {
  return (
    <a {...rest} className={buttonLook({ variant, size, className })}>
      {icon !== undefined && <Icon d={icon} size={iconSize} />}
      {children}
    </a>
  );
}
