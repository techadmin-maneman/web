// A camera's shutter (docs/prompts/tech-redesign.md, "Radius": circles only for, among a few, the camera's shutter): a
// white disc in a white ring, on the camera's dark. It waits, dimmed, until the camera has its first frame.

import { classes } from "./classes.ts";
import styles from "./shutter.module.css";

export function Shutter({
  label,
  disabled = false,
  onTake,
  className,
}: {
  /** What it does, for a screen reader: "Take". */
  readonly label: string;
  readonly disabled?: boolean;
  readonly onTake: () => void;
  readonly className?: string | undefined;
}) {
  return (
    <button
      type="button"
      className={classes(styles.shutter, className)}
      aria-label={label}
      disabled={disabled}
      onClick={onTake}
    >
      <span className={styles.fill} />
    </button>
  );
}
