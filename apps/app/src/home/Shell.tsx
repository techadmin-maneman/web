// The signed-in app's frame (design/phase2/Client App, boards B to G): a
// header, the page, anything the page keeps above the tabs, and the five tabs.
// The header is Home's mark and profile button, a tab's title, or a way back
// with the page's title. Each page pads itself, as its board does.

import { ICONS, ICONS_P2 } from "@maneman/brand/icons";
import { Mark } from "@maneman/ui/Mark";
import type { ReactNode } from "react";
import { Icon } from "../components/Icon.tsx";
import { home, states, tabs } from "../content.ts";
import { TAB_ICONS } from "../icons.ts";
import { go, type Tab } from "../route.ts";
import { useSession } from "../session.ts";
import styles from "./shell.module.css";

export type Header =
  | { readonly kind: "home" }
  | { readonly kind: "tab"; readonly title: string; readonly action?: ReactNode }
  | { readonly kind: "back"; readonly title: string; readonly to: string; readonly label: string };

interface Props {
  readonly header: Header;
  /** The tab the page sits under, marked in the bar; the profile sits under none. */
  readonly tab: Tab | null;
  /** Kept between the page and the tabs, as board C1's "Book your next visit". */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

/** A link within the app: the path changes without a reload. */
export function AppLink({
  to,
  className,
  label,
  children,
}: {
  to: string;
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={to}
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}

function PageHeader({ header }: { header: Header }) {
  const { me } = useSession();
  switch (header.kind) {
    case "home":
      return (
        <header className={styles.header}>
          <Mark className={styles.mark} />
          <AppLink className={styles.avatar} to="/profile" label={home.profile}>
            {me.initials}
          </AppLink>
        </header>
      );
    case "tab":
      return (
        <header className={styles.header}>
          <h1 className={styles.tabTitle}>{header.title}</h1>
          {header.action}
        </header>
      );
    case "back":
      return (
        <header className={`${styles.header} ${styles.titled}`}>
          <AppLink className={styles.back} to={header.to} label={header.label}>
            <Icon d={ICONS.back} size={22} />
          </AppLink>
          <h1 className={styles.name}>{header.title}</h1>
        </header>
      );
  }
}

export function Shell({ header, tab, footer, children }: Props) {
  const { offline } = useSession();
  return (
    <div className={styles.shell}>
      <PageHeader header={header} />
      {/* Always in the page, so a screen reader hears the banner come and go. */}
      <div role="status">
        {offline && (
          <p className={styles.offline}>
            <Icon className={styles.offlineIcon} d={ICONS_P2.offline} size={18} />
            <span>{states.offline}</span>
          </p>
        )}
      </div>
      <main className={styles.page}>{children}</main>
      {footer !== undefined && <div className={styles.footer}>{footer}</div>}
      <nav className={styles.tabs}>
        {tabs.map((each) => (
          <a
            key={each.page}
            className={styles.tab}
            href={each.page}
            aria-current={each.page === tab ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              go(each.page);
            }}
          >
            <Icon d={TAB_ICONS[each.icon]} size={21} />
            <span>{each.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
