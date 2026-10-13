// Words that act or go somewhere, among other words: underlined, never boxed. Their tone is the ground they stand on
// and what they say: plain on paper, muted beside a row's figures, on the ink, in brass for Home's prompt, or in
// oxblood for a figure that warns. `TextButton` does something; `TextLink` goes somewhere; an in-app link is the
// router's `Link`, given `textLinkLook()`.

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, MouseEvent, Ref } from "react";
import { classes } from "./classes.ts";
import styles from "./text-link.module.css";

export type TextTone = "plain" | "muted" | "ink" | "brass" | "danger";

interface Look {
  readonly tone?: TextTone;
  /** As tall as a table row allows, where it sits in one. */
  readonly compact?: boolean;
  readonly className?: string;
}

export const textLinkLook = ({ tone = "plain", compact = false, className }: Look = {}): string =>
  classes(styles.words, styles[tone], compact && styles.compact, className);

type LinkProps = Look &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "target" | "rel"> & {
    /** Opened beside the app, as a document or a payment page is. */
    readonly newTab?: boolean;
    readonly ref?: Ref<HTMLAnchorElement>;
  };

export function TextLink({ tone, compact, className, newTab = false, children, ...rest }: LinkProps) {
  const beside = newTab ? { target: "_blank", rel: "noopener noreferrer" } : { rel: "noopener" };
  return (
    <a {...rest} {...beside} className={textLinkLook({ tone, compact, className })}>
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

export function TextButton({ tone, compact, className, busy = false, type = "button", onClick, ...rest }: ButtonProps) {
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
      className={textLinkLook({ tone, compact, className })}
      aria-busy={busy ? true : undefined}
      onClick={click}
    />
  );
}
