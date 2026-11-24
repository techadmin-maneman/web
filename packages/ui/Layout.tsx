// How a page stacks what it holds, and how it sets tiles side by side, so a screen needs no stylesheet of its own to
// lay out its panels.
//
//   <Stack gap="20">{panels}</Stack>
//   <Columns>{tiles}</Columns>
//   <Split look="side">{main}{beside}</Split>

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

const SPLITS = { side: styles.splitSide, wide: styles.splitWide, even: styles.splitEven } as const;

/**
 * Two parts side by side on a wide desk, one above the other short of it: the second a column of its own (`side`),
 * the first the wider (`wide`), or both alike (`even`). Until the second is drawn, the first takes the whole width.
 */
export function Split({
  look,
  className,
  children,
}: {
  readonly look: keyof typeof SPLITS;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return <div className={classes(styles.split, SPLITS[look], className)}>{children}</div>;
}

/** Side by side, as many to a row as fit at their narrowest (--columns-tile, ./base.css), each row filled. */
export function Columns({
  gap = "16",
  row = false,
  className,
  children,
}: {
  readonly gap?: Gap;
  /** One even row, however many tiles, so none is left alone on a row of its own; rows of two on a phone. */
  readonly row?: boolean;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return <div className={classes(styles.columns, row && styles.row, GAPS[gap], className)}>{children}</div>;
}
