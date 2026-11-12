// The tab bar at the foot of the top-level screens (docs/prompts/tech-redesign.md, "Information architecture"): Today,
// Schedule, Kit and Me. Inside a job there are none. The bar takes the look of the screen above it, so a screen not
// yet redrawn keeps its ink to the foot (docs/decisions/0239-technician-light-look.md).

import { GLYPHS, TAB_ICONS } from "@maneman/brand/icons";
import { TabBar, TabBarItem } from "@maneman/ui/TabBar";
import { tabs as copy } from "../content.ts";
import type { Route } from "../route.ts";

// Each tab's name by its key, read as the bar is drawn, so it is in the language now.
const TABS = [
  { page: "today", to: "/", icon: TAB_ICONS.visits, name: "today" },
  { page: "week", to: "/week", icon: GLYPHS.schedule, name: "schedule" },
  { page: "kit", to: "/kit", icon: GLYPHS.box, name: "kit" },
  { page: "me", to: "/me", icon: GLYPHS.person, name: "me" },
] as const satisfies readonly { page: Route["page"]; to: string; icon: string; name: keyof typeof copy }[];

/** The pages under Me's tab beyond Me itself: the guides, read from Me. */
const UNDER_ME: ReadonlySet<Route["page"]> = new Set(["guides", "guide", "guideTask"]);

/** The pages a tab opens, under which the bar is drawn; a later job's preview is Schedule's, the guides Me's. */
const TABBED: ReadonlySet<Route["page"]> = new Set([...TABS.map((tab) => tab.page), "preview", ...UNDER_ME]);

/** The tabbed pages already drawn in the new look. */
const LIGHT: ReadonlySet<Route["page"]> = new Set(["today", "week", "preview", "kit", "me", ...UNDER_ME]);

/** The tab a page is under. */
function tabOf(page: Route["page"]): Route["page"] {
  if (page === "preview") return "week";
  return UNDER_ME.has(page) ? "me" : page;
}

export const hasTabs = (page: Route["page"]): boolean => TABBED.has(page);

export const drawnLight = (page: Route["page"]): boolean => LIGHT.has(page);

export function Tabs({ page }: { readonly page: Route["page"] }) {
  return (
    <div data-look={drawnLight(page) ? "light" : undefined}>
      <TabBar label={copy.label}>
        {TABS.map((tab) => (
          <TabBarItem
            key={tab.page}
            to={tab.to}
            icon={tab.icon}
            name={copy[tab.name]}
            current={tab.page === tabOf(page)}
          />
        ))}
      </TabBar>
    </div>
  );
}
