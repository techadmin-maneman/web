// The design's empty states (boards D3, E3 and F6): one line in the serif and
// one beneath it. Refer shows its empty state until its screens arrive with
// P2-F3.

import { Icon } from "../components/Icon.tsx";
import { empty } from "../content.ts";
import { Shell } from "./Shell.tsx";
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

export function ReferScreen() {
  return (
    <Shell header={{ kind: "tab", title: empty.refer.title }} tab="/refer">
      <EmptyState lines={empty.refer.lines} />
    </Shell>
  );
}
