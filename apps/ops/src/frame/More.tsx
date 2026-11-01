// More, on a phone (ADR 0225): the city every page is narrowed to, then the navigation's entries the tab bar has no
// room for, by kind of work, each with how many wait in it, and Settings last.

import { Stack } from "@maneman/ui/Layout";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { typeLook } from "@maneman/ui/type";
import { shell, written } from "../content.ts";
import { useMayCall } from "../lib/access.ts";
import { firstSetting, NAV_GROUP_NAMES, NAV_GROUPS, settingsPath, TAB_ENTRIES, type NavKey } from "../route.ts";
import { CityChips } from "./City.tsx";
import { useNavLines, waitingLabel } from "./Navigation.tsx";
import styles from "./more.module.css";

const MORE = { page: "more" } as const;

export function MoreScreen() {
  const lines = useNavLines(MORE);
  const setting = firstSetting(useMayCall());
  return (
    <Stack gap="24">
      <CityChips />
      {NAV_GROUPS.map(({ group, entries }) => {
        const shown = lines.filter(
          (line) => (entries as readonly NavKey[]).includes(line.entry) && !TAB_ENTRIES.includes(line.entry),
        );
        const settings = group === "admin" && setting !== null;
        if (shown.length === 0 && !settings) return null;
        const name = written(NAV_GROUP_NAMES[group]);
        return (
          <section key={group} className={styles.group} aria-label={name}>
            {name !== undefined && <h2 className={typeLook("label", styles.name)}>{name}</h2>}
            <ListRows>
              {shown.map((line) => (
                <ListRow
                  key={line.entry}
                  to={line.to}
                  title={line.name}
                  end={line.waiting === undefined ? undefined : String(line.waiting.count)}
                  endTone={line.waiting?.overdue === true ? "warning" : "muted"}
                  label={line.waiting === undefined ? undefined : waitingLabel(line.name, line.waiting)}
                />
              ))}
              {settings && <ListRow to={settingsPath(setting)} title={shell.settings} />}
            </ListRows>
          </section>
        );
      })}
    </Stack>
  );
}
