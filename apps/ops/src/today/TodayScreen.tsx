// Today (ADR 0227, ADR 0238): the person's one home, by their grants (./homes.ts). Its title is the home's sentence on
// the day, the date and the header's city above it; then the home's figures, what needs them, and the home's own list.

import { PanelLoading } from "@maneman/ui/States";
import { useLoad } from "@maneman/ui/useLoad";
import { apiNow } from "@maneman/web-kit/clock";
import { todayInIndia, weekdayDate } from "@maneman/web-kit/dates";
import type { ReactNode } from "react";
import type { Tasks } from "../api.ts";
import { tables } from "../content.ts";
import { today as copy } from "../content/today.ts";
import { useHeaderOver } from "../frame/PageHead.tsx";
import { whoami } from "../lib/access.ts";
import { useCity } from "../lib/city.ts";
import { useTaskBoard } from "../lib/waiting.ts";
import { CareHome } from "./CareHome.tsx";
import { CityHome } from "./CityHome.tsx";
import { DispatchHome } from "./DispatchHome.tsx";
import { FinanceHome } from "./FinanceHome.tsx";
import { homeOf, type Home } from "./homes.ts";
import { Needs } from "./Needs.tsx";

type HomeProps = { readonly board: Tasks; readonly needs: ReactNode };

const HOME_SCREENS: Readonly<Record<Home, (props: HomeProps) => ReactNode>> = {
  dispatch: DispatchHome,
  care: CareHome,
  city: CityHome,
  finance: FinanceHome,
};

export function TodayScreen() {
  const board = useTaskBoard(true);
  const { city } = useCity();
  const [signedIn] = useLoad(whoami);
  useHeaderOver(copy.day(weekdayDate(todayInIndia(apiNow())), city ?? tables.allCities));
  if (board === null || signedIn.state !== "loaded") return <PanelLoading />;
  const Screen = HOME_SCREENS[homeOf(signedIn.value.staff)];
  return <Screen board={board} needs={<Needs board={board} />} />;
}
