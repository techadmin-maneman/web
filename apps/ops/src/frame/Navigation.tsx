// The console's navigation (../route.ts, NAV and NAV_GROUPS): an entry for each job the person may open something in,
// with how many tasks wait in it, by kind of work under each kind's name, Settings in the last; the person signed in
// at its foot, and the way to fold it to its icons, kept in this browser. On a phone the tab bar stands in for it
// (./PhoneTabs.tsx).

import { GLYPHS, TAB_ICONS } from "@maneman/brand/icons";
import { capsLook } from "@maneman/ui/Caps";
import { classes } from "@maneman/ui/classes";
import { Mark } from "@maneman/ui/Mark";
import { FOLDS, NavButton, NavGroup, NavItem, SideNav } from "@maneman/ui/SideNav";
import { useState } from "react";
import { shell } from "../content.ts";
import { useMayCall } from "../lib/access.ts";
import { useTaskBoard } from "../lib/waiting.ts";
import {
  firstSetting,
  mayOpen,
  NAV_GROUP_NAMES,
  NAV_GROUPS,
  settingsPath,
  type NavKey,
  type Route,
  type SectionPath,
} from "../route.ts";
import { waitingIn, type Waiting } from "../tasks/decided.ts";
import { FootAccount } from "./Account.tsx";
import { navLines, type NavLine } from "./SectionGroups.tsx";
import styles from "./navigation.module.css";
import { apiNow } from "@maneman/web-kit/clock";

/** The navigation's id, which the narrow window's Menu button names. */
export const NAV_ID = "console-nav";

/** The navigation's icon for each entry, which the phone's tab bar and More draw too. */
export const NAV_ICONS: Readonly<Record<NavKey, string>> = {
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

const NOTHING_WAITING: ReadonlyMap<SectionPath, Waiting> = new Map();
const FOLDED = "mm-ops-nav-folded";

function keptFolded(): boolean {
  try {
    return localStorage.getItem(FOLDED) === "true";
  } catch {
    return false;
  }
}

function keepFolded(folded: boolean): void {
  try {
    localStorage.setItem(FOLDED, String(folded));
  } catch {
    // Folded for this page alone.
  }
}

/** Whether the navigation is folded to its icons, and the way to fold it or open it out. */
function useFolded(): [boolean, () => void] {
  const [folded, setFolded] = useState(keptFolded);
  const toggle = () => {
    keepFolded(!folded);
    setFolded(!folded);
  };
  return [folded, toggle];
}

/** An entry's name read out with what waits in it: "Tasks, 8 waiting, some overdue". */
export function waitingLabel(name: string, waiting: Waiting): string {
  if (waiting.of === "low_places") return shell.lowPlaces(name, waiting.count);
  return shell.waiting(name, waiting.count, waiting.overdue);
}

/** The entries, with what waits in each, as the person may open them; read again each minute a page is open. */
export function useNavLines(route: Route): NavLine[] {
  const mayCall = useMayCall();
  const board = useTaskBoard(mayCall !== null && mayOpen(mayCall, "tasks"));
  const waiting = board === null ? NOTHING_WAITING : waitingIn(board, new Date(apiNow()));
  const page = route.page === "settings" || route.page === "more" ? null : route.page;
  return navLines(mayCall, page, waiting);
}

function Entry({ line }: { readonly line: NavLine }) {
  return (
    <NavItem
      to={line.to}
      icon={NAV_ICONS[line.entry]}
      name={line.name}
      current={line.current}
      count={line.waiting?.count}
      urgent={line.waiting?.overdue === true}
      label={line.waiting === undefined ? undefined : waitingLabel(line.name, line.waiting)}
    />
  );
}

export function Navigation({ route, open, className }: { route: Route; open: boolean; className?: string }) {
  const mayCall = useMayCall();
  const [folded, fold] = useFolded();
  const lines = useNavLines(route);
  const setting = firstSetting(mayCall);
  return (
    <SideNav
      id={NAV_ID}
      className={className}
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
          <NavButton
            icon={GLYPHS.fold}
            name={folded ? shell.unfold : shell.fold}
            expanded={!folded}
            controls={NAV_ID}
            onClick={fold}
          />
          <FootAccount />
        </>
      }
    >
      {NAV_GROUPS.map(({ group, entries }) => {
        const shown = lines.filter((line) => (entries as readonly NavKey[]).includes(line.entry));
        const settings = group === "admin" && setting !== null;
        if (shown.length === 0 && !settings) return null;
        return (
          <NavGroup key={group} label={NAV_GROUP_NAMES[group]}>
            {shown.map((line) => (
              <Entry key={line.entry} line={line} />
            ))}
            {settings && (
              <NavItem
                to={settingsPath(setting)}
                icon={GLYPHS.sliders}
                name={shell.settings}
                current={route.page === "settings"}
              />
            )}
          </NavGroup>
        );
      })}
    </SideNav>
  );
}
