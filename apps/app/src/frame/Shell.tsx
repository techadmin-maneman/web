// The signed-in app's frame (design/client-redesign, docs/decisions/0252-client-app-redesign.md): a head, the
// offline bar, the page, the page's action bar, and the four tabs on a tab's own page. Home's head is the drawn mark,
// a tab's its title; each has the bell and the client's initials at the right. A page under a tab has a way back and
// its title. Each page pads itself.

import { APP_ICONS, CLIENT_ICONS, GLYPHS, ICONS } from "@maneman/brand/icons";
import { focusIfLost } from "@maneman/ui/arrival";
import { classes } from "@maneman/ui/classes";
import { Icon } from "@maneman/ui/Icon";
import { iconButtonLook } from "@maneman/ui/IconButton";
import { IconLink } from "@maneman/ui/IconLink";
import { Mark } from "@maneman/ui/Mark";
import { ARRIVE } from "@maneman/ui/motion";
import { Link } from "@maneman/ui/router";
import { TabBar, TabBarItem } from "@maneman/ui/TabBar";
import { useEffect, type ReactNode } from "react";
import { home, shell, states, tabs } from "../content.ts";
import type { Tab } from "../route.ts";
import { openIssues, unreadAlerts } from "../lib/counts.ts";
import { useSession } from "../session.ts";
import styles from "./shell.module.css";

/** A link within the app: the shared one, under the name the pages know it by. */
export { Link as AppLink } from "@maneman/ui/router";

type Header =
  | { readonly kind: "home" }
  | { readonly kind: "tab"; readonly title: string; readonly action?: ReactNode }
  | {
      readonly kind: "back";
      /** None where the page's own first heading names it, as the profile's name does. */
      readonly title?: string;
      readonly to: string;
      readonly label: string;
      /** A small action at the head's right, as Visits' "Edit". */
      readonly action?: ReactNode;
    };

interface Props {
  readonly header: Header;
  /** The tab whose own page this is, marked in the bar; a page under a tab has no bar. */
  readonly tab: Tab | null;
  /** The page's action bar, kept above the foot (packages/ui/ActionBar.tsx). */
  readonly footer?: ReactNode;
  /** The page draws the Home the phone kept, so offline it says it shows the last update. */
  readonly kept?: boolean;
  readonly children: ReactNode;
}

const TAB_ICON: Readonly<Record<Tab, string>> = {
  "/": CLIENT_ICONS.home,
  "/visits": CLIENT_ICONS.calendar,
  "/photos": CLIENT_ICONS.camera,
  "/rewards": CLIENT_ICONS.gift,
};

/** The bell and the client's initials, at the right of a tab's head. */
function HeadActions() {
  const { me } = useSession();
  const unread = unreadAlerts(me);
  return (
    <span className={styles.actions}>
      <IconLink to="/alerts" d={GLYPHS.bell} size="md" count={unread} label={shell.alerts(unread)} />
      <Link className={styles.initials} to="/profile" label={home.profile(me.initials)}>
        {me.initials}
      </Link>
    </span>
  );
}

function PageHeader({ header }: { header: Header }) {
  switch (header.kind) {
    case "home":
      return (
        <header className={styles.header}>
          <Mark className={styles.mark} />
          <HeadActions />
        </header>
      );
    case "tab":
      return (
        <header className={styles.header}>
          <h1 className={styles.tabTitle}>{header.title}</h1>
          {header.action}
          <HeadActions />
        </header>
      );
    case "back":
      return (
        <header className={classes(styles.header, styles.sub)}>
          <Link className={iconButtonLook(styles.back)} to={header.to} label={header.label}>
            <Icon d={ICONS.back} size="md" />
          </Link>
          {header.title !== undefined && <h1 className={styles.name}>{header.title}</h1>}
          {header.action}
        </header>
      );
  }
}

function Tabs({ tab }: { tab: Tab }) {
  const { me } = useSession();
  const counts: Readonly<Partial<Record<Tab, number>>> = {
    "/visits": openIssues(me),
    "/rewards": me.credits?.visits ?? 0,
  };
  return (
    <TabBar label={shell.tabsLabel} className={styles.tabs}>
      {tabs.map((each) => {
        const count = counts[each.page] ?? 0;
        return (
          <TabBarItem
            key={each.page}
            to={each.page}
            icon={TAB_ICON[each.page]}
            name={each.label}
            current={each.page === tab}
            count={count}
            label={count > 0 ? each.counted(count) : undefined}
          />
        );
      })}
    </TabBar>
  );
}

export function Shell({ header, tab, footer, kept = false, children }: Props) {
  // A page that loaded after the path changed draws its heading after App looked for it, so the page itself asks.
  useEffect(() => {
    focusIfLost(document.querySelector("h1"));
  }, []);
  const { offline } = useSession();
  return (
    <div className={classes(styles.shell, tab === null ? styles.noTabs : styles.withTabs)}>
      <PageHeader header={header} />
      {/* Always in the page, so a screen reader hears the bar come and go. */}
      <div className={styles.status} role="status">
        {offline && (
          <p className={styles.offline}>
            <Icon className={styles.offlineIcon} d={APP_ICONS.offline} size="sm" />
            <span>{kept ? states.offline : states.offlineOnly}</span>
          </p>
        )}
      </div>
      <main className={classes(styles.page, ARRIVE)}>{children}</main>
      {footer}
      {tab !== null && <Tabs tab={tab} />}
    </div>
  );
}
