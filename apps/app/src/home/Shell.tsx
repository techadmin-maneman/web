// The signed-in app: the header with the mark and the profile button, the
// page, and the five tabs (design/phase2/Client App, board B). Tabs change
// the page in place; Profile sits behind the button on Home.

import { ICONS, ICONS_P2 } from "@maneman/brand/icons";
import type { ReactNode } from "react";
import { Mark } from "../components/Mark.tsx";
import { Icon } from "../components/Icon.tsx";
import { home, profile, states, tabs } from "../content.ts";
import { TAB_ICONS } from "../icons.ts";
import { go, type Page } from "../route.ts";
import styles from "./shell.module.css";

interface Props {
  readonly page: Page;
  readonly initials: string;
  /** The profile's header (board G1): back to Home, and the client's name. */
  readonly name?: string;
  /** Board B3's offline state: what the page shows is the last update the phone kept. */
  readonly offline: boolean;
  readonly children: ReactNode;
}

export function Shell({ page, initials, name, offline, children }: Props) {
  return (
    <div className={styles.shell}>
      {name === undefined ? (
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
      ) : (
        <header className={`${styles.header} ${styles.titled}`}>
          <a
            className={styles.back}
            href="/"
            aria-label={profile.back}
            onClick={(event) => {
              event.preventDefault();
              go("/");
            }}
          >
            <Icon d={ICONS.back} size={22} />
          </a>
          <span className={styles.name}>{name}</span>
        </header>
      )}
      {/* Always in the page, so a screen reader hears the banner come and go. */}
      <div role="status">
        {offline && (
          <p className={styles.offline}>
            <Icon className={styles.offlineIcon} d={ICONS_P2.offline} size={18} />
            <span>{states.offline}</span>
          </p>
        )}
      </div>
      {/* Keyed by the page, so each page opens at its top. */}
      <main key={page} className={name === undefined ? styles.page : `${styles.page} ${styles.titledPage}`}>
        {children}
      </main>
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
