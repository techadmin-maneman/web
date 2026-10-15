// The console's navigation (../route.ts, NAV): an entry for each job the person may open something in, with how many
// tasks wait in it, Settings at its foot, and the way to fold it to its icons, kept in this browser.

import { GLYPHS, TAB_ICONS } from "@maneman/brand/icons";
import { capsLook } from "@maneman/ui/Caps";
import { classes } from "@maneman/ui/classes";
import { Mark } from "@maneman/ui/Mark";
import { FOLDS, NavButton, NavItem, SideNav } from "@maneman/ui/SideNav";
import { useState } from "react";
import { shell } from "../content.ts";
import { useMayCall } from "../lib/access.ts";
import { useTaskBoard } from "../lib/waiting.ts";
import { firstSetting, mayOpen, settingsPath, type NavKey, type Route, type SectionPath } from "../route.ts";
import { waitingIn, type Waiting } from "../tasks/decided.ts";
import { navLines } from "./SectionGroups.tsx";
import styles from "./navigation.module.css";

/** The navigation's id, which the narrow window's Menu button names. */
export const NAV_ID = "console-nav";

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
function waitingLabel(name: string, waiting: Waiting): string {
  if (waiting.of === "low_places") return shell.lowPlaces(name, waiting.count);
  return shell.waiting(name, waiting.count, waiting.overdue);
}

function SettingsEntry({ current }: { current: boolean }) {
  const setting = firstSetting(useMayCall());
  if (setting === null) return null;
  return (
    <ul className={styles.footItems}>
      <NavItem to={settingsPath(setting)} icon={GLYPHS.sliders} name={shell.settings} current={current} />
    </ul>
  );
}

export function Navigation({ route, open }: { route: Route; open: boolean }) {
  const mayCall = useMayCall();
  const [folded, fold] = useFolded();
  const board = useTaskBoard(mayCall !== null && mayOpen(mayCall, "tasks"));
  const waiting = board === null ? NOTHING_WAITING : waitingIn(board, new Date());
  const page = route.page === "settings" ? null : route.page;
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
          <SettingsEntry current={route.page === "settings"} />
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
