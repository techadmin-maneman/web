// Settings' frame: its own menu down the left, by group, and the page beside it; and the bar that rises at the page's
// foot once something has changed, with how many and the way on.
//
//   <SettingsLayout menu={<SubNav label={copy.menu} groups={groups} />}>{page}</SettingsLayout>

import { GLYPHS } from "@maneman/brand/icons";
import { useId, useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import { Link } from "./router.tsx";
import styles from "./settings-layout.module.css";

export function SettingsLayout({ menu, children }: { readonly menu: ReactNode; readonly children: ReactNode }) {
  return (
    <div className={styles.layout}>
      {menu}
      <div className={styles.page}>{children}</div>
    </div>
  );
}

export interface SubNavGroup {
  readonly name: string;
  readonly items: readonly { readonly name: string; readonly to: string; readonly current: boolean }[];
}

function Group({
  group,
  open,
  onToggle,
}: {
  readonly group: SubNavGroup;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const id = useId();
  return (
    <div className={styles.group}>
      <button type="button" className={styles.groupName} aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <Icon className={styles.fold} d={GLYPHS.chevron} size="xs" />
        {group.name}
      </button>
      <ul id={id} className={styles.items} hidden={!open}>
        {group.items.map((item) => (
          <li key={item.to}>
            <Link className={styles.item} to={item.to} current={item.current}>
              {item.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A menu by group, each group's name a button that folds its pages away: the open page's group shows its pages, the
 * rest only their names until opened, and every group shows its pages while `unfolded` (a search's matches). A group
 * with no page is left out; `children` sit above the groups.
 */
export function SubNav({
  label,
  groups,
  unfolded = false,
  children,
}: {
  readonly label: string;
  readonly groups: readonly SubNavGroup[];
  readonly unfolded?: boolean;
  readonly children?: ReactNode;
}) {
  /** The groups opened or folded by hand; the rest follow the open page. */
  const [byHand, setByHand] = useState<Readonly<Record<string, boolean>>>({});
  const openOf = (group: SubNavGroup) => unfolded || (byHand[group.name] ?? group.items.some((item) => item.current));
  return (
    <nav className={styles.menu} aria-label={label}>
      {children}
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <Group
            key={group.name}
            group={group}
            open={openOf(group)}
            onToggle={() => {
              setByHand((already) => ({ ...already, [group.name]: !openOf(group) }));
            }}
          />
        ))}
    </nav>
  );
}

/** At the foot of the page while a change waits: how many, and the buttons that discard it or take it on. */
export function ChangeBar({ count, children }: { readonly count: string; readonly children: ReactNode }) {
  return (
    <div className={styles.bar}>
      <span className={styles.count} aria-live="polite">
        {count}
      </span>
      <div className={styles.actions}>{children}</div>
    </div>
  );
}
