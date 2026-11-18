// The chevron at a row's end that says it opens, as the prototype draws every one: in the controls' grey, a glyph held
// to a control's 3:1 rather than words' 4.5:1 (WCAG 1.4.11).

import { GLYPHS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import styles from "./chevron.module.css";

export function Chevron() {
  return <Icon className={styles.chevron} d={GLYPHS.chevron} size="sm" />;
}
