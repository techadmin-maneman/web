// A control that is only its icon, the tap's size and named for a screen reader: the back arrow at a screen's head,
// a sheet's way out. The client app's tap is --tap, the technician app's --tech-min; an app sets
// --icon-button-size, the colour and the edge's margin on its own class.

import type { ButtonHTMLAttributes } from "react";
import { classes } from "./classes.ts";
import { Icon } from "./Icon.tsx";
import styles from "./icon-button.module.css";

/** The look, for a link that is only its icon: a screen's way back to another page. */
export const iconButtonLook = (className?: string): string => classes(styles.iconButton, className);

export function IconButton({
  d,
  label,
  size,
  stroke,
  className,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  /** The icon's path, from @maneman/brand/icons. */
  readonly d: string;
  /** What it does, for a screen reader: "Back". */
  readonly label: string;
  readonly size: number;
  readonly stroke?: number;
}) {
  return (
    <button {...rest} type={type} className={iconButtonLook(className)} aria-label={label}>
      <Icon d={d} size={size} stroke={stroke} />
    </button>
  );
}
