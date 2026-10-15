// Nothing to show yet. On a page, the client app's design: one line in the serif and one beneath it, a glyph above
// where Photos draws one, and a way on beneath. In a console panel or table, one muted line.

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import { Icon } from "./Icon.tsx";
import styles from "./empty-state.module.css";

export function EmptyState(
  props:
    | {
        readonly look: "page";
        readonly lines: readonly [string, string];
        /** Lines 12 px apart, as the documents set them; 16 otherwise. */
        readonly tight?: boolean;
        readonly icon?: string;
        readonly action?: ReactNode;
      }
    | { readonly look: "panel"; readonly line: ReactNode },
) {
  if (props.look === "panel") return <p className={styles.panel}>{props.line}</p>;
  const [first, second] = props.lines;
  return (
    <div className={classes(styles.page, props.tight === true ? styles.tight : undefined)}>
      {props.icon !== undefined && <Icon className={styles.icon} d={props.icon} size="lg" />}
      <p className={styles.first}>{first}</p>
      <p className={styles.line}>{second}</p>
      {props.action}
    </div>
  );
}
