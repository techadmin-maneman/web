// The console's frame (design/phase2/Ops Console), which App draws once round whichever page is open: the navigation on
// ink down the left, by department, with only the sections the person may open and how many tasks wait in each; and a
// header naming the section, with who is signed in at its right.

import { SkipLink } from "@maneman/ui/SkipLink";
import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Mark } from "@maneman/ui/Mark";
import { Link, usePath } from "@maneman/ui/router";
import { useLoad } from "@maneman/ui/useLoad";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { shell } from "../content.ts";
import { useMayCall, whoami } from "../lib/access.ts";
import { useLapsed } from "../lib/session.ts";
import { useTaskBoard } from "../lib/waiting.ts";
import { mayOpen, SECTIONS, type MayCall, type SectionPath } from "../route.ts";
import { DEPARTMENTS, type Department } from "../lib/grants.ts";
import { waitingIn, type Waiting } from "../tasks/decided.ts";
import { Account } from "./Account.tsx";
import { ClientFinder } from "./ClientFinder.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { GroupTabs, navEntries, type NavEntry } from "./SectionGroups.tsx";
import styles from "./shell.module.css";

/** A link within the console: the shared one, which leaves a click asking for a new tab to the browser. */
export { Link as OpsLink } from "@maneman/ui/router";

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

function SectionLink({ section, name, current, waiting }: Omit<NavEntry, "key">) {
  if (waiting === undefined) {
    return (
      <Link className={styles.section} to={section.path} current={current}>
        {name}
      </Link>
    );
  }
  return (
    <Link
      className={styles.section}
      to={section.path}
      current={current}
      label={
        waiting.of === "low_places"
          ? shell.lowPlaces(name, waiting.count)
          : shell.waiting(name, waiting.count, waiting.overdue)
      }
    >
      {name}
      <span className={waiting.overdue ? styles.overdue : styles.count}>{waiting.count}</span>
    </Link>
  );
}

interface DepartmentProps {
  readonly department: Department;
  readonly current: SectionPath;
  readonly mayCall: MayCall;
  readonly waiting: ReadonlyMap<SectionPath, Waiting>;
}

/** One department's sections under its name; nothing for a department the person may open nothing in. */
function DepartmentSections({ department, current, mayCall, waiting }: DepartmentProps) {
  const sections = SECTIONS.filter((each) => each.department === department && mayOpen(mayCall, each.page));
  if (sections.length === 0) return null;
  const entries = navEntries(sections, current, waiting);
  const nameId = `nav-${department}`;
  return (
    <div className={styles.department}>
      <p className={capsLook(styles.departmentName)} id={nameId}>
        {shell.departments[department]}
      </p>
      <ul className={styles.sections} aria-labelledby={nameId}>
        {entries.map(({ key, ...entry }) => (
          <li key={key}>
            <SectionLink {...entry} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const NOTHING_WAITING: ReadonlyMap<SectionPath, Waiting> = new Map();

const NAV_ID = "console-nav";

function Navigation({ current, open }: { current: SectionPath; open: boolean }) {
  const mayCall = useMayCall();
  const board = useTaskBoard(mayCall !== null && mayOpen(mayCall, "tasks"));
  const waiting = board === null ? NOTHING_WAITING : waitingIn(board, new Date());
  return (
    <nav id={NAV_ID} className={styles.nav} data-open={open} aria-label={shell.title}>
      <div className={styles.brand}>
        <Mark className={styles.mark} />
        <span className={capsLook(styles.brandName)}>{shell.title}</span>
      </div>
      {DEPARTMENTS.map((department) => (
        <DepartmentSections
          key={department}
          department={department}
          current={current}
          mayCall={mayCall}
          waiting={waiting}
        />
      ))}
    </nav>
  );
}

/**
 * The navigation's place in a narrow window: folded away until Menu opens it, and folded again as a page opens or
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

/** The header's button to the navigation, drawn only in a narrow window. */
function MenuButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="quiet"
      size="small"
      className={styles.menu}
      aria-expanded={open}
      aria-controls={NAV_ID}
      onClick={onToggle}
    >
      {open ? shell.closeMenu : shell.menu}
    </Button>
  );
}

/**
 * Moves the focus to the heading when another page opens, so the keyboard starts at the new page and a screen reader
 * names it. The first page of a load leaves the focus where the browser put it, and a page that has put the focus
 * somewhere of its own keeps it there.
 */
function useFocusOnArrival(heading: RefObject<HTMLHeadingElement | null>, page: RefObject<HTMLElement | null>): void {
  const path = usePath();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const arrived = shown.current !== null && shown.current !== path;
    shown.current = path;
    if (arrived && page.current?.contains(document.activeElement) !== true) heading.current?.focus();
  }, [heading, page, path]);
}

const HeaderSub = createContext<(sub: string | undefined) => void>(() => undefined);

/** A line beside the title for as long as the page is open, as the dispatch board puts its week there. */
export function useHeaderSub(sub: string | undefined): void {
  const setSub = useContext(HeaderSub);
  useEffect(() => {
    setSub(sub);
    return () => {
      setSub(undefined);
    };
  }, [setSub, sub]);
}

interface Props {
  /** The section shown, marked in the navigation. */
  readonly section: SectionPath;
  readonly title: string;
  /** The dispatch board fills the frame to its edges, where every other section is padded. */
  readonly flush?: boolean;
  /** The Clients page has its own search, so its header has none. */
  readonly finder?: boolean;
  /** Why the page was just read again, said above it (lib/refresh.ts). */
  readonly note?: string | null;
  readonly children: ReactNode;
}

export function Shell({ section, title, flush, finder = true, note = null, children }: Props) {
  const lapsed = useLapsed();
  const heading = useRef<HTMLHeadingElement>(null);
  const main = useRef<HTMLElement>(null);
  const [sub, setSub] = useState<string | undefined>();
  const menu = useMenu();
  useFocusOnArrival(heading, main);
  return (
    <div className={styles.console}>
      <SkipLink
        onSkip={() => {
          main.current?.focus();
        }}
      >
        {shell.skip}
      </SkipLink>
      <Navigation current={section} open={menu.open} />
      <CommandPalette />
      <div className={styles.body}>
        <header className={styles.header}>
          <MenuButton open={menu.open} onToggle={menu.toggle} />
          <div className={styles.heading}>
            <h1 className={styles.title} ref={heading} tabIndex={-1}>
              {title}
            </h1>
            {sub !== undefined && <span className={styles.sub}>{sub}</span>}
          </div>
          {finder && <ClientFinder />}
          <Account />
        </header>
        {lapsed && <Lapsed />}
        <NotListed />
        <main id="content" ref={main} tabIndex={-1} className={flush === true ? styles.flushPage : styles.page}>
          <GroupTabs section={section} />
          <div aria-live="polite">
            {note !== null && (
              <InlineMessage tone="note" className={styles.note}>
                {note}
              </InlineMessage>
            )}
          </div>
          <HeaderSub value={setSub}>{children}</HeaderSub>
        </main>
      </div>
    </div>
  );
}
