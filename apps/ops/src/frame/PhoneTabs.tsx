// The navigation on a phone (ADR 0225): a tab bar for the day's work, with how many wait in each as the navigation
// counts them, and More for the rest, which is current wherever a page the tab bar has no tab for is open.

import { GLYPHS } from "@maneman/brand/icons";
import { TabBar, TabBarItem } from "@maneman/ui/TabBar";
import { shell } from "../content.ts";
import { MORE_PATH, TAB_ENTRIES, type Route } from "../route.ts";
import { NAV_ICONS, useNavLines, waitingLabel } from "./Navigation.tsx";

export function PhoneTabs({ route, className }: { readonly route: Route; readonly className?: string }) {
  const lines = useNavLines(route);
  const tabs = lines.filter((line) => TAB_ENTRIES.includes(line.entry));
  const elsewhere = route.page === "more" || !tabs.some((line) => line.current);
  return (
    <TabBar className={className} label={shell.title}>
      {tabs.map((line) => (
        <TabBarItem
          key={line.entry}
          to={line.to}
          icon={NAV_ICONS[line.entry]}
          name={line.name}
          current={line.current}
          count={line.waiting?.count}
          urgent={line.waiting?.overdue === true}
          label={line.waiting === undefined ? undefined : waitingLabel(line.name, line.waiting)}
        />
      ))}
      <TabBarItem to={MORE_PATH} icon={GLYPHS.more} name={shell.more} current={elsewhere} />
    </TabBar>
  );
}
