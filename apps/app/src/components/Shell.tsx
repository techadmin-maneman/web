// The signed-in app's frame (design/phase2/Client App, boards B to G): a
// header, the page, anything the page keeps above the tabs, and the five tabs.
// The header is Home's mark and profile button, a tab's title, or a way back
// with the page's title. Each page pads itself, as its board does.

import { iconButtonLook } from "@maneman/ui/IconButton";
import { ICONS, ICONS_P2 } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { classes } from "@maneman/ui/classes";
import { Mark } from "@maneman/ui/Mark";
import { ARRIVE } from "@maneman/ui/motion";
import { Link } from "@maneman/ui/router";
import type { ReactNode } from "react";
import { home, states, tabs } from "../content.ts";
import { TAB_ICONS } from "../icons.ts";
import type { Tab } from "../route.ts";
import { useSession } from "../session.ts";
import styles from "../home/shell.module.css";

/** A link within the app: the shared one, under the name the pages know it by. */
export { Link as AppLink } from "@maneman/ui/router";

type Header =
  | { readonly kind: "home" }
  | { readonly kind: "tab"; readonly title: string; readonly action?: ReactNode }
  | { readonly kind: "back"; readonly title: string; readonly to: string; readonly label: string };

interface Props {
  readonly header: Header;
  /** The tab the page sits under, marked in the bar; the profile sits under none. */
  readonly tab: Tab | null;
  /** Kept between the page and the tabs, as board C1's "Book your next visit". */
  readonly footer?: ReactNode;
  /** The page draws the Home the phone kept, so offline it says it shows the last update. */
  readonly kept?: boolean;
  readonly children: ReactNode;
}

function PageHeader({ header }: { header: Header }) {
  const { me } = useSession();
  switch (header.kind) {
    case "home":
      return (
        <header className={styles.header}>
          <Mark className={styles.mark} />
          <Link className={styles.avatar} to="/profile" label={home.profile(me.initials)}>
            {me.initials}
          </Link>
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
        <header className={classes(styles.header, styles.titled)}>
          <Link className={iconButtonLook(styles.back)} to={header.to} label={header.label}>
            <Icon d={ICONS.back} size={22} />
          </Link>
          <h1 className={styles.name}>{header.title}</h1>
        </header>
      );
  }
}

export function Shell({ header, tab, footer, kept = false, children }: Props) {
  const { offline } = useSession();
  return (
    <div className={styles.shell}>
      <PageHeader header={header} />
      {/* Always in the page, so a screen reader hears the banner come and go. */}
      <div role="status">
        {offline && (
          <p className={styles.offline}>
            <Icon className={styles.offlineIcon} d={ICONS_P2.offline} size={18} />
            <span>{kept ? states.offline : states.offlineOnly}</span>
          </p>
        )}
      </div>
      <main className={classes(styles.page, ARRIVE)}>{children}</main>
      {footer !== undefined && <div className={styles.footer}>{footer}</div>}
      <nav className={styles.tabs}>
        {tabs.map((each) => (
          <Link key={each.page} className={styles.tab} to={each.page} current={each.page === tab}>
            <Icon d={TAB_ICONS[each.icon]} size={21} />
            <span>{each.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
