// A line saying what just happened, where it happened: an error, said at once; a change saved, said when the reader
// is next free; or a plain note. The look is the same on every surface; the screen gives only where it stands.

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./inline-message.module.css";

const ROLES = { error: "alert", saved: "status", note: undefined } as const;

type Tone = "error" | "saved" | "note";

/** The look alone, for a page that draws its own element, as the site's islands do. */
export const messageLook = (look: { tone: Tone; ground?: "paper" | "ink"; className?: string | undefined }) =>
  classes(styles.message, styles[look.tone], look.ground === "ink" ? styles.onInk : undefined, look.className);

export function InlineMessage({
  tone,
  ground = "paper",
  className,
  id,
  children,
}: {
  readonly tone: Tone;
  readonly ground?: "paper" | "ink";
  /** Where the screen sets it: its margins, never its colour or size. */
  readonly className?: string | undefined;
  /** For a box whose error it is, by aria-describedby. */
  readonly id?: string;
  readonly children: ReactNode;
}) {
  return (
    <p className={messageLook({ tone, ground, className })} role={ROLES[tone]} id={id}>
      {children}
    </p>
  );
}
