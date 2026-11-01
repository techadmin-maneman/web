// A side navigation on the ink: its head (the mark and the name), its entries, each an icon and a name with how many
// wait there, and its foot. Folded, it keeps the icons alone, and each entry is named by its title and its label.
//
//   <SideNav label={copy.title} folded={folded} head={…} foot={…}>
//     <NavGroup label={copy.work}>
//       <NavItem to="/tasks" icon={GLYPHS.tasks} name="Tasks" count={8} urgent current />
//     </NavGroup>
//   </SideNav>

import { useId, type ReactNode } from "react";
import { capsLook } from "./Caps.tsx";
import { Icon } from "./Icon.tsx";
import { Popover } from "./Popover.tsx";
import { Link } from "./router.tsx";
import { classes } from "./classes.ts";
import styles from "./side-nav.module.css";

/** Words in the navigation's head that fold away with the names: the app's own name beside its mark. */
export const FOLDS = styles.folds;

export function SideNav({
  id,
  label,
  folded = false,
  open = false,
  head,
  foot,
  className,
  children,
}: {
  readonly id?: string;
  readonly label: string;
  /** Folded to its icons, at a desk. */
  readonly folded?: boolean;
  /** Opened over the page in a narrow window. */
  readonly open?: boolean;
  readonly head?: ReactNode;
  readonly foot?: ReactNode;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <nav id={id} className={classes(styles.nav, className)} data-folded={folded} data-open={open} aria-label={label}>
      {head !== undefined && <div className={styles.head}>{head}</div>}
      <ul className={styles.items}>{children}</ul>
      {foot !== undefined && <div className={styles.foot}>{foot}</div>}
    </nav>
  );
}

/**
 * Entries for one kind of work under its name in small capitals, which folds away with the entries' names; set apart
 * from the group before it, named or not.
 */
export function NavGroup({ label, children }: { readonly label?: string | undefined; readonly children: ReactNode }) {
  const id = useId();
  return (
    <li className={styles.group}>
      {label !== undefined && (
        <span className={capsLook(styles.groupLabel)} id={id}>
          {label}
        </span>
      )}
      <ul className={styles.groupItems} aria-labelledby={label === undefined ? undefined : id}>
        {children}
      </ul>
    </li>
  );
}

export function NavItem({
  to,
  icon,
  name,
  current,
  count,
  urgent = false,
  label,
}: {
  readonly to: string;
  readonly icon: string;
  readonly name: string;
  readonly current: boolean;
  /** How many wait there; none for an entry nothing waits in. */
  readonly count?: number | undefined;
  /** Some of them are overdue. */
  readonly urgent?: boolean;
  /** Its name with its count, read out, where the count alone would not say what it counts. */
  readonly label?: string | undefined;
}) {
  return (
    <li>
      <Link className={styles.item} to={to} current={current} label={label} title={name}>
        <Icon className={styles.icon} d={icon} size="sm" />
        <span className={styles.name}>{name}</span>
        {count !== undefined && count > 0 && <span className={urgent ? styles.urgent : styles.count}>{count}</span>}
      </Link>
    </li>
  );
}

/** A button in the navigation's foot, as its fold is: an icon and its name, the name folded away with the rest. */
export function NavButton({
  icon,
  name,
  onClick,
  expanded,
  controls,
}: {
  readonly icon: string;
  readonly name: string;
  readonly onClick: () => void;
  readonly expanded?: boolean;
  readonly controls?: string;
}) {
  return (
    <button
      type="button"
      className={styles.item}
      title={name}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
    >
      <Icon className={styles.icon} d={icon} size="sm" />
      <span className={styles.name}>{name}</span>
    </button>
  );
}

/**
 * Who is signed in, in the navigation's foot: their initials, name and e-mail, the button that opens what is theirs
 * (the theme, the way out). Folded, the initials alone.
 */
export function NavAccount({
  label,
  initials,
  name,
  detail,
  children,
}: {
  /** Read out, holding the name it shows: "Account, Priya Sharma". */
  readonly label: string;
  readonly initials: string;
  readonly name: string;
  /** Beneath the name: their e-mail. */
  readonly detail?: string | undefined;
  readonly children: (close: () => void) => ReactNode;
}) {
  return (
    <Popover
      look="ink"
      side="above"
      align="start"
      className={styles.account}
      label={label}
      button={
        <>
          <span className={styles.initials} aria-hidden="true">
            {initials}
          </span>
          <span className={styles.person}>
            <span className={styles.personName}>{name}</span>
            {detail !== undefined && <span className={styles.personDetail}>{detail}</span>}
          </span>
        </>
      }
    >
      {children}
    </Popover>
  );
}
