// The design's empty states (boards D3 and E3): one line in the serif and one
// beneath it.

import { Icon } from "@maneman/ui/Icon";
import styles from "./tabs.module.css";

/** `tight` sets the lines 12 px apart, as board E3 does, where D3 and F6 set them 14; D3 draws a glyph above. */
export function EmptyState(props: { lines: readonly [string, string]; tight?: boolean; icon?: string }) {
  const [first, second] = props.lines;
  return (
    <div className={props.tight === true ? `${styles.empty} ${styles.tight}` : styles.empty}>
      {props.icon !== undefined && <Icon className={styles.emptyIcon} d={props.icon} size={24} />}
      <p className={styles.emptyFirst}>{first}</p>
      <p className={styles.line}>{second}</p>
    </div>
  );
}
