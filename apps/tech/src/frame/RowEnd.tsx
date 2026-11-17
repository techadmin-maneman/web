// A one-line row's end, as the prototype's Account list draws it on Me: what the row holds, 14 px in the soft ink, then
// the chevron that says it opens.

import { GLYPHS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import type { ReactNode } from "react";
import styles from "./row-end.module.css";

export function RowEnd({ value }: { readonly value: ReactNode }) {
  return (
    <span className={styles.end}>
      {value !== null && <span className={styles.value}>{value}</span>}
      <Icon d={GLYPHS.chevron} size="sm" />
    </span>
  );
}
