// Today (ADR 0227): the person's home, chosen by their grants (./homes.ts). Its title is the home's sentence on the
// day, the date and the header's city above it, and the choice of home beside it for a person with more than one; then
// the home's figures, what needs them, and the home's own list.

import { Stack } from "@maneman/ui/Layout";
import { PanelLoading } from "@maneman/ui/States";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { useLoad } from "@maneman/ui/useLoad";
import { apiNow } from "@maneman/web-kit/clock";
import { todayInIndia, weekdayDate } from "@maneman/web-kit/dates";
import { useState, type ReactNode } from "react";
import type { Tasks } from "../api.ts";
import { tables } from "../content.ts";
import { today as copy } from "../content/today.ts";
import { PageActions, useHeaderOver } from "../frame/PageHead.tsx";
import { whoami } from "../lib/access.ts";
import { useCity } from "../lib/city.ts";
import { useTaskBoard } from "../lib/waiting.ts";
import { CareHome } from "./CareHome.tsx";
import { CityHome } from "./CityHome.tsx";
import { DispatchHome } from "./DispatchHome.tsx";
import { FinanceHome } from "./FinanceHome.tsx";
import { homeLists, homesOf, type Home } from "./homes.ts";
import { InventoryHome } from "./InventoryHome.tsx";
import { Needs } from "./Needs.tsx";
import styles from "./today.module.css";

type HomeProps = { readonly board: Tasks; readonly needs: ReactNode };

const HOME_SCREENS: Readonly<Record<Home, (props: HomeProps) => ReactNode>> = {
  dispatch: DispatchHome,
  care: CareHome,
  city: CityHome,
  finance: FinanceHome,
  inventory: InventoryHome,
};

function HomeChoice(props: { homes: readonly Home[]; home: Home; onChoose: (home: Home) => void }) {
  return (
    <div className={styles.homes} role="radiogroup" aria-label={copy.homes.label}>
      {props.homes.map((each) => (
        <ToggleButton
          key={each}
          asRadio
          filled
          pressed={each === props.home}
          onClick={() => {
            props.onChoose(each);
          }}
        >
          {copy.homes.names[each]}
        </ToggleButton>
      ))}
    </div>
  );
}

export function TodayScreen() {
  const board = useTaskBoard(true);
  const { city } = useCity();
  const [signedIn] = useLoad(whoami);
  const [chosen, setChosen] = useState<Home | null>(null);
  useHeaderOver(copy.day(weekdayDate(todayInIndia(apiNow())), city ?? tables.allCities));
  if (board === null || signedIn.state !== "loaded") return <PanelLoading />;
  const homes = homesOf(signedIn.value.staff);
  const home = chosen !== null && homes.includes(chosen) ? chosen : (homes[0] ?? "dispatch");
  const Screen = HOME_SCREENS[home];
  return (
    <Stack gap="24">
      {homes.length > 1 && (
        <PageActions>
          <HomeChoice homes={homes} home={home} onChoose={setChosen} />
        </PageActions>
      )}
      <Screen board={board} needs={<Needs board={board} lists={(group) => homeLists(home, homes, group)} />} />
    </Stack>
  );
}
