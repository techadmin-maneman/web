// The navigation's entries over the pages of work (../route.ts, NAV): each entry opens on the first of its pages the
// person may open and counts what waits across them; and, at the head of each page of an entry of several, the
// entry's pages as tabs.

import { Link } from "@maneman/ui/router";
import { Tabs, TAB } from "@maneman/ui/Tabs";
import { useMayCall } from "../lib/access.ts";
import {
  mayOpen,
  NAV,
  NAV_NAMES,
  navOf,
  SECTION_NAMES,
  sectionOf,
  type MayCall,
  type NavKey,
  type Page,
  type SectionPath,
} from "../route.ts";
import type { Waiting } from "../tasks/decided.ts";

/** One entry of the navigation, as the person may open it. */
export interface NavLine {
  readonly entry: NavKey;
  readonly name: string;
  readonly to: SectionPath;
  readonly current: boolean;
  readonly waiting: Waiting | undefined;
}

/** What waits across an entry's pages: their counts together, overdue if any is; one page's own as it is. */
function together(waits: readonly (Waiting | undefined)[]): Waiting | undefined {
  const known = waits.filter((each): each is Waiting => each !== undefined);
  if (known.length <= 1) return known[0];
  return {
    count: known.reduce((sum, each) => sum + each.count, 0),
    overdue: known.some((each) => each.overdue),
    of: "tasks",
  };
}

/** The navigation's entries the person may open something in, each on its first such page. */
export function navLines(
  mayCall: MayCall,
  current: Page | null,
  waiting: ReadonlyMap<SectionPath, Waiting>,
): NavLine[] {
  return NAV.flatMap((entry): NavLine[] => {
    const pages = (entry.pages as readonly Page[]).filter((page) => mayOpen(mayCall, page));
    const first = pages[0];
    if (first === undefined) return [];
    return [
      {
        entry: entry.entry,
        name: NAV_NAMES[entry.entry],
        to: sectionOf(first).path,
        current: current !== null && pages.includes(current),
        waiting: together(pages.map((page) => waiting.get(sectionOf(page).path))),
      },
    ];
  });
}

/** The entry's pages as tabs at the head of one of them; nothing for an entry of one page. */
export function GroupTabs({ page }: { readonly page: Page }) {
  const mayCall = useMayCall();
  const entry = navOf(page);
  const open = (entry.pages as readonly Page[]).filter((each) => mayOpen(mayCall, each));
  if (open.length < 2) return null;
  return (
    <Tabs label={NAV_NAMES[entry.entry]}>
      {open.map((each) => (
        <Link key={each} className={TAB} to={sectionOf(each).path} current={each === page}>
          {SECTION_NAMES[each]}
        </Link>
      ))}
    </Tabs>
  );
}
