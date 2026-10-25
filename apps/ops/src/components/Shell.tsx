// The console's frame, which App draws once round whichever page is open: the navigation on the ink down the left,
// an entry for each job with how many tasks wait in it and Settings at its foot; a bar across the top with where the
// page sits, the search and the person signed in; and the page's head, its title, figures, actions and tabs.

import { GLYPHS } from "@maneman/brand/icons";
import { Breadcrumbs, type Crumb } from "@maneman/ui/Breadcrumbs";
import { Button } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { PageHeader, PageTitle } from "@maneman/ui/PageHeader";
import { Link, usePath, wasRedirected } from "@maneman/ui/router";
import { SkipLink } from "@maneman/ui/SkipLink";
import { textLinkLook } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { shell } from "../content.ts";
import { whoami } from "../lib/access.ts";
import { useLapsed } from "../lib/session.ts";
import {
  NAV_NAMES,
  navOf,
  SECTION_NAMES,
  sectionOf,
  SETTINGS_GROUP_NAMES,
  settingsPageOf,
  SETTINGS_PAGE_NAMES,
  type Route,
} from "../route.ts";
import { Account } from "./Account.tsx";
import { Mine } from "./Mine.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { Navigation, NAV_ID } from "./Navigation.tsx";
import { PageHead } from "./PageHead.tsx";
import { GroupTabs } from "./SectionGroups.tsx";
import styles from "./shell.module.css";

/**
 * A link within the console: the shared one, which leaves a click asking for a new tab to the browser, in the shared
 * link's look unless the caller gives its own.
 */
export function OpsLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} className={props.className ?? textLinkLook()} />;
}

/** Said once, over whichever screen is open, when Access stops letting the console's calls through. */
function Lapsed() {
  return (
    <div className={styles.lapsed} role="alert">
      <p className={styles.lapsedLine}>{shell.lapsed}</p>
      <Button
        variant="primary"
        size="small"
        onClick={() => {
          window.location.reload();
        }}
      >
        {shell.reload}
      </Button>
    </div>
  );
}

/** Whether the person is one Access lets in whom the Staff list, once enforced, does not. */
export function useNotListed(): boolean {
  const [loaded] = useLoad(whoami);
  if (loaded.state !== "loaded") return false;
  const { enforced, listed } = loaded.value.staff;
  return enforced && !listed;
}

/** Said over every screen to a person Access lets in whom the Staff list, once enforced, does not. */
function NotListed() {
  if (!useNotListed()) return null;
  return (
    <div className={styles.lapsed} role="status">
      <p className={styles.lapsedLine}>{shell.notListed}</p>
    </div>
  );
}

/**
 * The navigation's place in a narrow window: off the page until Menu opens it, and away again as a page opens or
 * Escape is pressed. In a wide one it stands beside the page and the button is not drawn.
 */
function useMenu(): { open: boolean; toggle: () => void } {
  const path = usePath();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [path]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  return {
    open,
    toggle: () => {
      setOpen((now) => !now);
    },
  };
}

/**
 * Moves the focus to the heading when another page opens, so the keyboard starts at the new page and a screen reader
 * names it. The first page of a load leaves the focus where the browser put it, as does a redirect, which shows the
 * page already open under its own address, and a page that has put the focus somewhere of its own keeps it there.
 */
function useFocusOnArrival(heading: RefObject<HTMLHeadingElement | null>, page: RefObject<HTMLElement | null>): void {
  const path = usePath();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const arrived = shown.current !== null && shown.current !== path && !wasRedirected();
    shown.current = path;
    if (arrived && page.current?.contains(document.activeElement) !== true) heading.current?.focus();
  }, [heading, page, path]);
}

/** Where the page sits: its entry above a page of several, its section above a record, Settings' group above its page. */
function crumbsOf(route: Route, record: string | undefined): Crumb[] {
  if (route.page === "settings") {
    const page = settingsPageOf(route.tab);
    return [{ label: shell.settings }, { label: SETTINGS_GROUP_NAMES[page.group] }];
  }
  const section = sectionOf(route.page);
  if (record !== undefined) return [{ label: SECTION_NAMES[route.page], to: section.path }];
  const entry = navOf(route.page);
  return entry.pages.length > 1 ? [{ label: NAV_NAMES[entry.entry] }] : [];
}

/** The page's title: a record's own name, Settings' page, or the page's. */
function pageTitleOf(route: Route, record: string | undefined): string {
  if (record !== undefined) return record;
  return route.page === "settings" ? SETTINGS_PAGE_NAMES[route.tab] : SECTION_NAMES[route.page];
}

interface Props {
  readonly route: Route;
  /** The dispatch board fills the frame beneath its head to its edges, where every other page is padded. */
  readonly flush?: boolean;
  /** Why the page was just read again, said above it (lib/refresh.ts). */
  readonly note?: string | null;
  readonly children: ReactNode;
}

export function Shell({ route, flush = false, note = null, children }: Props) {
  const lapsed = useLapsed();
  const heading = useRef<HTMLHeadingElement>(null);
  const main = useRef<HTMLElement>(null);
  const [sub, setSub] = useState<string | undefined>();
  const [record, setRecord] = useState<string | undefined>();
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [searching, setSearching] = useState(false);
  const search = useCallback(() => {
    setSearching(true);
  }, []);
  const stopSearching = useCallback(() => {
    setSearching(false);
  }, []);
  const menu = useMenu();
  useFocusOnArrival(heading, main);
  const crumbs = crumbsOf(route, record);
  const title = pageTitleOf(route, record);
  return (
    <div className={styles.console}>
      <SkipLink
        onSkip={() => {
          main.current?.focus();
        }}
      >
        {shell.skip}
      </SkipLink>
      <Navigation route={route} open={menu.open} />
      <CommandPalette open={searching} onOpen={search} onClose={stopSearching} />
      <div className={styles.body}>
        <header className={styles.bar}>
          <Button
            variant="quiet"
            size="small"
            className={styles.menu}
            aria-expanded={menu.open}
            aria-controls={NAV_ID}
            onClick={menu.toggle}
          >
            {menu.open ? shell.closeMenu : shell.menu}
          </Button>
          <div className={styles.crumbs}>
            {crumbs.length > 0 && <Breadcrumbs label={shell.crumbs} crumbs={[...crumbs, { label: title }]} />}
          </div>
          <Button variant="quiet" size="small" className={styles.search} onClick={search}>
            <Icon d={GLYPHS.search} size="xs" />
            {shell.search}
            <kbd className={styles.keys}>{shell.searchKeys}</kbd>
          </Button>
          <Mine />
          <Account />
        </header>
        {lapsed && <Lapsed />}
        <NotListed />
        <main id="content" ref={main} tabIndex={-1} className={flush ? styles.flushPage : styles.page}>
          <PageHeader
            className={flush ? styles.flushHead : styles.head}
            title={title}
            titleRef={heading}
            meta={sub}
            actions={<div className={styles.actions} ref={setActions} />}
            tabs={route.page === "settings" || record !== undefined ? undefined : <GroupTabs page={route.page} />}
          />
          <div aria-live="polite">
            {note !== null && (
              <InlineMessage tone="note" className={styles.note}>
                {note}
              </InlineMessage>
            )}
          </div>
          <PageHead value={{ setSub, setRecord, actions }}>
            <PageTitle value={title}>{children}</PageTitle>
          </PageHead>
        </main>
      </div>
    </div>
  );
}
