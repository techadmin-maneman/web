// The signed-in app: the header with the mark and the profile button, the
// page, and the five tabs (design/phase2/Client App, board B). Tabs change
// the page in place; Profile sits behind the button on Home.

import type { ReactNode } from "react";
import { Mark } from "../components/Mark.tsx";
import { Icon } from "../components/Icon.tsx";
import { home, tabs } from "../content.ts";
import { TAB_ICONS } from "../icons.ts";
import { go, type Page } from "../route.ts";
import styles from "./shell.module.css";

interface Props {
  readonly page: Page;
  readonly initials: string;
  readonly children: ReactNode;
}

export function Shell({ page, initials, children }: Props) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Mark className={styles.mark} />
        <a
          className={styles.avatar}
          href="/profile"
          aria-label={home.profile}
          onClick={(event) => {
            event.preventDefault();
            go("/profile");
          }}
        >
          {initials}
        </a>
      </header>
      <main className={styles.page}>{children}</main>
      <nav className={styles.tabs}>
        {tabs.map((tab) => (
          <a
            key={tab.page}
            className={styles.tab}
            href={tab.page}
            aria-current={tab.page === page ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              go(tab.page);
            }}
          >
            <Icon d={TAB_ICONS[tab.icon]} size={21} />
            <span>{tab.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
