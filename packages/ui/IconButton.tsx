// A control that is only its icon, the tap's size and named for a screen reader: the back arrow at a screen's head,
// a sheet's way out. The client app's tap is --tap, the technician app's --tech-min; an app sets
// --icon-button-size, the colour and the edge's margin on its own class.

import type { IconSize, IconWeight } from "@maneman/brand/icons";
import type { ButtonHTMLAttributes } from "react";
import { classes } from "./classes.ts";
import { Icon } from "./Icon.tsx";
import styles from "./icon-button.module.css";

/** The look, for a link that is only its icon: a screen's way back to another page, or the site's WhatsApp chat. */
export const iconButtonLook = (className?: string, edged = false): string =>
  classes(styles.iconButton, edged && styles.edged, className);

export function IconButton({
  d,
  label,
  size,
  weight,
  edged = false,
  className,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  /** Edged on the ink, as a stepper's minus and plus are. */
  readonly edged?: boolean;
  /** The icon's path, from @maneman/brand/icons. */
  readonly d: string;
  /** What it does, for a screen reader: "Back". */
  readonly label: string;
  readonly size: IconSize;
  readonly weight?: IconWeight;
}) {
  return (
    <button {...rest} type={type} className={iconButtonLook(className, edged)} aria-label={label}>
      <Icon d={d} size={size} weight={weight} />
    </button>
  );
}
