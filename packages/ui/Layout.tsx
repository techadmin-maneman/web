// How a page stacks what it holds, and how it sets tiles side by side, so a screen needs no stylesheet of its own to
// lay out its panels.
//
//   <Stack gap="20">{panels}</Stack>
//   <Columns>{tiles}</Columns>

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./layout.module.css";

export type Gap = "8" | "12" | "16" | "20" | "24" | "32";

const GAPS: Record<Gap, string | undefined> = {
  "8": styles.gap8,
  "12": styles.gap12,
  "16": styles.gap16,
  "20": styles.gap20,
  "24": styles.gap24,
  "32": styles.gap32,
};

/** One under another, the gap between each two. */
export function Stack({
  gap = "20",
  className,
  children,
}: {
  readonly gap?: Gap;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return <div className={classes(styles.stack, GAPS[gap], className)}>{children}</div>;
}

/** Side by side, as many to a row as fit at their narrowest (--columns-tile, ./base.css), each row filled. */
export function Columns({
  gap = "16",
  className,
  children,
}: {
  readonly gap?: Gap;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return <div className={classes(styles.columns, GAPS[gap], className)}>{children}</div>;
}
