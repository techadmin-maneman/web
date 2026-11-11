// A link that is only its icon, the tap's size and named for a screen reader, with how many wait behind it over its
// corner: the technician app's alerts bell at the head of Today. An app sets --icon-button-size and the colour on its
// own class, as for an IconButton (./IconButton.tsx).
//
//   <IconLink to="/alerts" d={GLYPHS.bell} size="md" label={copy.bell(unread)} count={unread} />

import type { IconSize } from "@maneman/brand/icons";
import { quantity } from "@maneman/web-kit/figures";
import { classes } from "./classes.ts";
import { Icon } from "./Icon.tsx";
import { iconButtonLook } from "./IconButton.tsx";
import { Link } from "./router.tsx";
import styles from "./icon-link.module.css";

export function IconLink(props: {
  readonly to: string;
  /** The icon's path, from @maneman/brand/icons. */
  readonly d: string;
  readonly size: IconSize;
  /** Its name with its count, read out: "Alerts, 3 new". */
  readonly label: string;
  /** How many wait; none shows for nought. */
  readonly count?: number;
  readonly className?: string | undefined;
}) {
  const count = props.count ?? 0;
  return (
    <Link className={classes(iconButtonLook(props.className), styles.iconLink)} to={props.to} label={props.label}>
      <Icon d={props.d} size={props.size} />
      {count > 0 && (
        <span className={styles.count} aria-hidden="true">
          {quantity(count)}
        </span>
      )}
    </Link>
  );
}
