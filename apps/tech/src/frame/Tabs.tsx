// The tab bar at the foot of the top-level screens (docs/prompts/tech-redesign.md, "Information architecture"): Today,
// Schedule, Kit and Me. Inside a job there are none. The bar takes the look of the screen above it, so a screen not
// yet redrawn keeps its ink to the foot (docs/decisions/0239-technician-light-look.md).

import { GLYPHS, TAB_ICONS } from "@maneman/brand/icons";
import { TabBar, TabBarItem } from "@maneman/ui/TabBar";
import { tabs as copy } from "../content.ts";
import type { Route } from "../route.ts";

const TABS = [
  { page: "today", to: "/", icon: TAB_ICONS.visits, name: copy.today },
  { page: "week", to: "/week", icon: GLYPHS.schedule, name: copy.schedule },
  { page: "kit", to: "/kit", icon: GLYPHS.box, name: copy.kit },
  { page: "me", to: "/me", icon: GLYPHS.person, name: copy.me },
] as const satisfies readonly { page: Route["page"]; to: string; icon: string; name: string }[];

/** The pages a tab opens, under which the bar is drawn. */
const TABBED: ReadonlySet<Route["page"]> = new Set(TABS.map((tab) => tab.page));

/** The tabbed pages already drawn in the new look. */
const LIGHT: ReadonlySet<Route["page"]> = new Set(["today", "me"]);

export const hasTabs = (page: Route["page"]): boolean => TABBED.has(page);

export const drawnLight = (page: Route["page"]): boolean => LIGHT.has(page);

export function Tabs({ page }: { readonly page: Route["page"] }) {
  return (
    <div data-look={drawnLight(page) ? "light" : undefined}>
      <TabBar label={copy.label}>
        {TABS.map((tab) => (
          <TabBarItem key={tab.page} to={tab.to} icon={tab.icon} name={tab.name} current={tab.page === page} />
        ))}
      </TabBar>
    </div>
  );
}
