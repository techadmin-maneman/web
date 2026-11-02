// The navigation's entries over the pages of work (../route.ts, NAV): each entry opens on the first of its pages the
// person may open and counts what waits across them; and, at the head of each page of an entry of several, the
// entry's pages as tabs.

import { Link } from "@maneman/ui/router";
import { Tabs, TAB } from "@maneman/ui/Tabs";
import { useMayCall, type OpsCall } from "../lib/access.ts";
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
  type Route,
  type SectionPath,
  STOCK_VIEWS,
  stockPath,
} from "../route.ts";
import { stock } from "../content/stock.ts";
import { mayOpenView } from "../stock/views.ts";
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

/** Stock's views, a tab each in Inventory's row in Stock's place, as the person may open them. */
function StockTabs({ route }: { readonly route: WorkRoute }) {
  const mayCall = useMayCall();
  const mayAsk = (call: OpsCall) => mayCall === null || mayCall.has(call);
  return STOCK_VIEWS.filter((view) => mayOpenView(view, mayAsk)).map((view) => (
    <Link key={view} className={TAB} to={stockPath(view)} current={route.page === "stock" && route.view === view}>
      {stock.views.names[view]}
    </Link>
  ));
}

/** A page of work's route: one with a group's tabs over it, not Settings or More. */
type WorkRoute = Exclude<Route, { readonly page: "more" | "settings" }>;

/** The entry's pages as tabs at the head of one of them, Stock as its views; nothing for an entry of one page. */
export function GroupTabs({ route }: { readonly route: WorkRoute }) {
  const mayCall = useMayCall();
  const entry = navOf(route.page);
  const open = (entry.pages as readonly Page[]).filter((each) => mayOpen(mayCall, each));
  if (open.length < 2) return null;
  return (
    <Tabs label={NAV_NAMES[entry.entry]}>
      {open.map((each) =>
        each === "stock" ? (
          <StockTabs key={each} route={route} />
        ) : (
          <Link key={each} className={TAB} to={sectionOf(each).path} current={each === route.page}>
            {SECTION_NAMES[each]}
          </Link>
        ),
      )}
    </Tabs>
  );
}
