// Words that act or go somewhere, among other words: underlined, never boxed. Their tone is the ground they stand on
// and what they say: plain on paper, muted beside a row's figures, on the ink, in brass for Home's prompt, in
// oxblood for a figure that warns, or strong, in the strong colour underlined in its own, as the site's pages of text
// draw a link. `TextButton` does something; `TextLink` goes somewhere; an in-app link is the
// router's `Link`, given `textLinkLook()`.

import { useContext, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type MouseEvent, type Ref } from "react";
import { classes } from "./classes.ts";
import { ActionContent, useTipOf } from "./ActionContent.tsx";
import { IconActions } from "./icon-actions.ts";
import styles from "./text-link.module.css";

export type TextTone = "plain" | "muted" | "ink" | "brass" | "danger" | "strong";

interface Look {
  readonly tone?: TextTone;
  /** As tall as a table row allows, where it sits in one. */
  readonly compact?: boolean;
  /** In a sentence: the line's own height, and the sentence's colour and weight, the tone's underline beneath it. */
  readonly inline?: boolean;
  /** A way about the site, in its header or footer: underlined only when pointed at. */
  readonly quiet?: boolean;
  readonly className?: string | undefined;
}

export const textLinkLook = ({
  tone = "plain",
  compact = false,
  inline = false,
  quiet = false,
  className,
}: Look = {}): string =>
  classes(
    styles.words,
    styles[tone],
    compact && styles.compact,
    inline && styles.inline,
    quiet && styles.quiet,
    className,
  );

type LinkProps = Look &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "target" | "rel"> & {
    /** Opened beside the app, as a document or a payment page is. */
    readonly newTab?: boolean;
    readonly ref?: Ref<HTMLAnchorElement>;
  };

export function TextLink({ tone, compact, inline, quiet, className, newTab = false, children, ...rest }: LinkProps) {
  const beside = newTab ? { target: "_blank", rel: "noopener noreferrer" } : { rel: "noopener" };
  return (
    <a {...rest} {...beside} className={textLinkLook({ tone, compact, inline, quiet, className })}>
      {children}
    </a>
  );
}

type ButtonProps = Look &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
    /** Working on what the tap asked for: said to a screen reader, and a second tap does nothing. */
    readonly busy?: boolean;
    readonly ref?: Ref<HTMLButtonElement>;
  };

export function TextButton({
  tone,
  compact,
  inline,
  quiet,
  className,
  busy = false,
  type = "button",
  icon,
  onClick,
  children,
  ...rest
}: ButtonProps & {
  /** Its icon, from @maneman/brand/action-icons: in the console it is drawn alone, its words its name. */
  readonly icon?: string;
}) {
  const iconOnly = useContext(IconActions) && icon !== undefined;
  const click = (event: MouseEvent<HTMLButtonElement>) => {
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
      className={textLinkLook({
        tone,
        compact,
        inline,
        quiet,
        className: classes(iconOnly && styles.iconOnly, className),
      })}
      aria-busy={busy ? true : undefined}
      data-tip={useTipOf(icon, rest["aria-label"], children)}
      onClick={click}
    >
      <ActionContent icon={icon}>{children}</ActionContent>
    </button>
  );
}
