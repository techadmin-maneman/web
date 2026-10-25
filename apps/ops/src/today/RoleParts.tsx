// Today's parts for each kind of work (./TodayScreen.tsx), each shown to whoever's access reaches its page: the day on
// the road, from today's column of the dispatch board; Care's last week of replies; and Growth's last 30 days.

import { Columns } from "@maneman/ui/Layout";
import { Panel } from "@maneman/ui/Panel";
import { StatTile } from "@maneman/ui/StatTile";
import { useLoad } from "@maneman/ui/useLoad";
import { todayInIndia } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import type { Board } from "../api.ts";
import { today as copy } from "../content/today.ts";
import { useAccess } from "../lib/access.ts";
import { sectionOf } from "../route.ts";
import { todayApi } from "./today-api.ts";
import styles from "./today.module.css";

type Block = Board["technicians"][number]["days"][number]["blocks"][number];

/** Where each of today's visits stands: done, under way, past its start with nobody there yet, or still to come. */
function roadOf(blocks: readonly Block[], now: number) {
  const done = blocks.filter((block) => block.status === "completed" || block.begun === "closed").length;
  const underWay = blocks.filter(
    (block) => block.status !== "completed" && (block.begun === "arrived" || block.begun === "started"),
  ).length;
  const waiting = blocks.filter(
    (block) => block.begun === null && (block.status === "scheduled" || block.status === "dispatched"),
  );
  const late = waiting.filter((block) => Date.parse(block.starts_at) < now).length;
  return { visits: blocks.length, done, underWay, late, toCome: waiting.length - late };
}

function Road() {
  const date = todayInIndia(Date.now());
  const read = useCallback(() => todayApi.board(date), [date]);
  const [loaded] = useLoad(read);
  if (loaded.state !== "loaded") return null;
  const blocks = loaded.value.technicians.flatMap(
    (technician) => technician.days.find((day) => day.date === date)?.blocks ?? [],
  );
  const road = roadOf(blocks, Date.now());
  const board = sectionOf("dispatch").path;
  return (
    <Panel titleId="today-road" title={copy.road.title}>
      <Columns className={styles.tiles}>
        <StatTile label={copy.tiles.visits} value={road.visits} to={board} />
        <StatTile label={copy.road.done} value={road.done} to={board} />
        <StatTile label={copy.road.underWay} value={road.underWay} to={board} />
        <StatTile label={copy.road.late} value={road.late} tone={road.late > 0 ? "warning" : "plain"} to={board} />
        <StatTile label={copy.road.toCome} value={road.toCome} to={board} />
      </Columns>
    </Panel>
  );
}

function Care() {
  const [loaded] = useLoad(todayApi.care);
  if (loaded.state !== "loaded") return null;
  const { replies } = loaded.value;
  const page = sectionOf("care-numbers").path;
  return (
    <Panel titleId="today-care" title={copy.care.title}>
      <Columns className={styles.tiles}>
        <StatTile
          label={copy.care.median}
          value={replies.median_minutes === null ? copy.care.none : copy.care.minutes(replies.median_minutes)}
          to={page}
        />
        <StatTile
          label={copy.care.onTime}
          value={replies.within_target === null ? copy.care.none : copy.care.percent(replies.within_target)}
          to={page}
        />
      </Columns>
    </Panel>
  );
}

function Growth() {
  const [loaded] = useLoad(todayApi.funnel);
  if (loaded.state !== "loaded") return null;
  const page = sectionOf("funnel").path;
  return (
    <Panel titleId="today-growth" title={copy.growth.title}>
      <Columns className={styles.tiles}>
        <StatTile label={copy.growth.leads} value={loaded.value.steps.leads} to={page} />
        <StatTile label={copy.growth.fitted} value={loaded.value.steps.fitted} to={page} />
      </Columns>
    </Panel>
  );
}

/** The parts the person's access reaches, in the order the day runs: the road, Care, then Growth. */
export function RoleParts() {
  const access = useAccess();
  return (
    <>
      {access.mayCall("GET /api/dispatch") && <Road />}
      {access.mayCall("GET /api/care-numbers") && <Care />}
      {access.mayCall("GET /api/growth/funnel") && <Growth />}
    </>
  );
}
