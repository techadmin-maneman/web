// The console's frame (design/phase2/Ops Console, boards A1 and B1): the
// navigation column on ink down the left, a header naming the section with who
// is signed in at its right, and the section's panels. The navigation groups
// the sections by department, shows only those the person may open, and says
// how many tasks wait in each.

import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { Mark } from "@maneman/ui/Mark";
import { Link } from "@maneman/ui/router";
import { useLoad } from "@maneman/ui/useLoad";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { shell } from "../content.ts";
import { useMayCall, whoami } from "../lib/access.ts";
import { useLapsed } from "../lib/session.ts";
import { useTaskBoard } from "../lib/waiting.ts";
import { mayOpen, SECTION_NAMES, SECTIONS, type MayCall, type Section, type SectionPath } from "../route.ts";
import { DEPARTMENTS, type Department } from "../lib/grants.ts";
import { waitingIn, type Waiting } from "../tasks/decided.ts";
import { Account } from "./Account.tsx";
import { ClientFinder } from "./ClientFinder.tsx";
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

function SectionLink({ section, current, waiting }: { section: Section; current: boolean; waiting?: Waiting }) {
  const name = SECTION_NAMES[section.page];
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
  const nameId = `nav-${department}`;
  return (
    <div className={styles.department}>
      <p className={capsLook(styles.departmentName)} id={nameId}>
        {shell.departments[department]}
      </p>
      <ul className={styles.sections} aria-labelledby={nameId}>
        {sections.map((each) => (
          <li key={each.page}>
            <SectionLink section={each} current={each.path === current} waiting={waiting.get(each.path)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const NOTHING_WAITING: ReadonlyMap<SectionPath, Waiting> = new Map();

function Navigation({ current }: { current: SectionPath }) {
  const mayCall = useMayCall();
  const board = useTaskBoard(mayCall !== null && mayOpen(mayCall, "tasks"));
  const waiting = board === null ? NOTHING_WAITING : waitingIn(board, new Date());
  return (
    <nav className={styles.nav} aria-label={shell.title}>
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

/** The path of the page last opened: the first of a load leaves the focus where the browser put it. */
let shownPath: string | null = null;

/**
 * Moves the focus to the page's heading when another page has opened in this one's place, so the keyboard starts at
 * the new page and a screen reader names it. A page that has put the focus somewhere of its own keeps it there.
 */
function useFocusOnArrival(heading: RefObject<HTMLHeadingElement | null>): void {
  useEffect(() => {
    const path = window.location.pathname;
    const arrived = shownPath !== null && shownPath !== path;
    shownPath = path;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (arrived && lost) heading.current?.focus();
  }, [heading]);
}

interface Props {
  /** The section shown, marked in the navigation. */
  readonly section: SectionPath;
  readonly title: string;
  /** Beside the title, as the design puts the week's dates beside "Dispatch". */
  readonly sub?: string;
  /** The dispatch board fills the frame to its edges, where every other section is padded. */
  readonly flush?: boolean;
  /** The Clients page has its own search, so its header has none. */
  readonly finder?: boolean;
  readonly children: ReactNode;
}

export function Shell({ section, title, sub, flush, finder = true, children }: Props) {
  const lapsed = useLapsed();
  const heading = useRef<HTMLHeadingElement>(null);
  const main = useRef<HTMLElement>(null);
  useFocusOnArrival(heading);
  return (
    <div className={styles.console}>
      <a
        className={styles.skip}
        href="#content"
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
      >
        {shell.skip}
      </a>
      <Navigation current={section} />
      <div className={styles.body}>
        <header className={styles.header}>
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
          {children}
        </main>
      </div>
    </div>
  );
}
