// The named text styles (./type.module.css): a screen asks for a style, "title-3" for a panel's head, rather than a
// size, so the hierarchy reads the same on every surface. A screen's own class adds its colour and place.

import { classes } from "./classes.ts";
import styles from "./type.module.css";

const STYLES = {
  display: styles.display,
  "title-1": styles.title1,
  "title-2": styles.title2,
  "title-3": styles.title3,
  "body-large": styles.bodyLarge,
  body: styles.body,
  label: styles.label,
  caption: styles.caption,
  figure: styles.figure,
} as const;

export type TextStyle = keyof typeof STYLES;

export const typeLook = (style: TextStyle, className?: string): string => classes(STYLES[style], className);
