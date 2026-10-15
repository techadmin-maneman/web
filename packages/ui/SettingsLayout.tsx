// Settings' frame: its own menu down the left, by group, and the page beside it; and the bar that rises at the page's
// foot once something has changed, with how many and the way on.
//
//   <SettingsLayout menu={<SubNav label={copy.menu} groups={groups} />}>{page}</SettingsLayout>

import type { ReactNode } from "react";
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

/** A menu by group, each group's name over its pages; a group with no page is left out. */
export function SubNav({ label, groups }: { readonly label: string; readonly groups: readonly SubNavGroup[] }) {
  return (
    <nav className={styles.menu} aria-label={label}>
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.name}>
            <p className={styles.groupName}>{group.name}</p>
            <ul className={styles.items}>
              {group.items.map((item) => (
                <li key={item.to}>
                  <Link className={styles.item} to={item.to} current={item.current}>
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
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
