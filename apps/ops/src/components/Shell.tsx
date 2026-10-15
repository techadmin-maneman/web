// The console's frame, which App draws once round whichever page is open: the navigation on the ink down the left,
// an entry for each job with how many tasks wait in it and Settings at its foot; a bar across the top with where the
// page sits, the search and the person signed in; and the page's head, its title, figures, actions and tabs.

import { GLYPHS, TAB_ICONS } from "@maneman/brand/icons";
import { Breadcrumbs, type Crumb } from "@maneman/ui/Breadcrumbs";
import { Button } from "@maneman/ui/Button";
import { capsLook } from "@maneman/ui/Caps";
import { classes } from "@maneman/ui/classes";
import { Icon } from "@maneman/ui/Icon";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Mark } from "@maneman/ui/Mark";
import { PageHeader, PageTitle } from "@maneman/ui/PageHeader";
import { usePath, wasRedirected } from "@maneman/ui/router";
import { FOLDS, NavButton, NavItem, SideNav } from "@maneman/ui/SideNav";
import { SkipLink } from "@maneman/ui/SkipLink";
import { useLoad } from "@maneman/ui/useLoad";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { shell } from "../content.ts";
import { useMayCall, whoami } from "../lib/access.ts";
import { useLapsed } from "../lib/session.ts";
import { useTaskBoard } from "../lib/waiting.ts";
import {
  firstSetting,
  mayOpen,
  NAV_NAMES,
  navOf,
  SECTION_NAMES,
  sectionOf,
  settingsPath,
  SETTINGS_GROUP_NAMES,
  settingsPageOf,
  SETTINGS_PAGE_NAMES,
  type NavKey,
  type Route,
  type SectionPath,
} from "../route.ts";
import { waitingIn, type Waiting } from "../tasks/decided.ts";
import { Account } from "./Account.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { GroupTabs, navLines } from "./SectionGroups.tsx";
import styles from "./shell.module.css";

/** A link within the console: the shared one, which leaves a click asking for a new tab to the browser. */
export { Link as OpsLink } from "@maneman/ui/router";

const ICONS: Readonly<Record<NavKey, string>> = {
  today: TAB_ICONS.home,
  tasks: GLYPHS.tasks,
  dispatch: GLYPHS.board,
  clients: GLYPHS.person,
  messages: GLYPHS.bubble,
  technicians: GLYPHS.people,
  inventory: GLYPHS.box,
  requests: GLYPHS.tray,
  money: TAB_ICONS.payments,
  growth: GLYPHS.rise,
  reports: GLYPHS.bars,
};

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

const NOTHING_WAITING: ReadonlyMap<SectionPath, Waiting> = new Map();
const NAV_ID = "console-nav";
const FOLDED = "mm-ops-nav-folded";

/** Whether the navigation is folded to its icons, kept in this browser. */
function useFolded(): [boolean, () => void] {
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem(FOLDED) === "true";
    } catch {
      return false;
    }
  });
  return [
    folded,
    () => {
      setFolded((now) => {
        try {
          localStorage.setItem(FOLDED, String(!now));
        } catch {
          // Folded for this page alone.
        }
        return !now;
      });
    },
  ];
}

function waitingLabel(name: string, waiting: Waiting): string {
  return waiting.of === "low_places"
    ? shell.lowPlaces(name, waiting.count)
    : shell.waiting(name, waiting.count, waiting.overdue);
}

function Navigation({ route, open }: { route: Route; open: boolean }) {
  const mayCall = useMayCall();
  const [folded, fold] = useFolded();
  const board = useTaskBoard(mayCall !== null && mayOpen(mayCall, "tasks"));
  const waiting = board === null ? NOTHING_WAITING : waitingIn(board, new Date());
  const page = route.page === "settings" ? null : route.page;
  const setting = firstSetting(mayCall);
  return (
    <SideNav
      id={NAV_ID}
      label={shell.title}
      folded={folded}
      open={open}
      head={
        <>
          <Mark className={styles.mark} />
          <span className={capsLook(classes(FOLDS, styles.brandName))}>{shell.title}</span>
        </>
      }
      foot={
        <>
          {setting !== null && (
            <ul className={styles.footItems}>
              <NavItem
                to={settingsPath(setting)}
                icon={GLYPHS.sliders}
                name={shell.settings}
                current={route.page === "settings"}
              />
            </ul>
          )}
          <NavButton
            icon={GLYPHS.fold}
            name={folded ? shell.unfold : shell.fold}
            expanded={!folded}
            controls={NAV_ID}
            onClick={fold}
          />
        </>
      }
    >
      {navLines(mayCall, page, waiting).map((line) => (
        <NavItem
          key={line.entry}
          to={line.to}
          icon={ICONS[line.entry]}
          name={line.name}
          current={line.current}
          count={line.waiting?.count}
          urgent={line.waiting?.overdue === true}
          label={line.waiting === undefined ? undefined : waitingLabel(line.name, line.waiting)}
        />
      ))}
    </SideNav>
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

/** What a page tells its head while it is open: figures beside the title, a record's own name, its actions' place. */
interface Head {
  readonly setSub: (sub: string | undefined) => void;
  readonly setRecord: (name: string | undefined) => void;
  readonly actions: HTMLElement | null;
}

const PageHead = createContext<Head>({ setSub: () => undefined, setRecord: () => undefined, actions: null });

/** A line of figures beside the title for as long as the page is open, as the dispatch board puts its week there. */
export function useHeaderSub(sub: string | undefined): void {
  const { setSub } = useContext(PageHead);
  useEffect(() => {
    setSub(sub);
    return () => {
      setSub(undefined);
    };
  }, [setSub, sub]);
}

/** A record's own name as the page's title, its section a step above it: a client's, a technician's. */
export function useRecordTitle(name: string | undefined): void {
  const { setRecord } = useContext(PageHead);
  useEffect(() => {
    setRecord(name);
    return () => {
      setRecord(undefined);
    };
  }, [setRecord, name]);
}

/** The page's own actions, drawn at the right of its head. */
export function PageActions({ children }: { readonly children: ReactNode }) {
  const { actions } = useContext(PageHead);
  return actions === null ? null : createPortal(children, actions);
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

function titleOf(route: Route, record: string | undefined): string {
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
  const title = titleOf(route, record);
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
