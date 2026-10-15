// Today: the figures that matter now, each a tile that opens where it is acted on, and the tasks that need the person,
// longest overdue first. It reads the board the navigation reads and the day's routes; each tile is shown only to a
// person who may open the page it leads to.

import { Columns, Stack } from "@maneman/ui/Layout";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Panel } from "@maneman/ui/Panel";
import { StatTile, type StatTone } from "@maneman/ui/StatTile";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import type { Task, TaskGroup, Tasks } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { tasks as taskWords } from "../content.ts";
import { today as copy } from "../content/today.ts";
import { useAccess, useMayCall } from "../lib/access.ts";
import { Left } from "../lib/Left.tsx";
import { decidedAt, subjectOf, taskClientPath } from "../lib/task-links.ts";
import { useTaskBoard } from "../lib/waiting.ts";
import { mayOpen, type Page, sectionOf } from "../route.ts";
import { Loading } from "../states/States.tsx";
import { todayApi } from "./today-api.ts";

type Group = TaskGroup["group"];

/** How many the board holds in the groups named; none for a group the person is not shown. */
const countOf = (board: Tasks, groups: readonly Group[]): number =>
  board.groups.filter((each) => groups.includes(each.group)).reduce((sum, each) => sum + each.count, 0);

/**
 * A tile: what it counts, the page it opens, and the tone a figure above nought takes. A tile counts the board's groups
 * it names, or one of the board's own totals.
 */
interface Tile {
  readonly key: keyof typeof copy.tiles;
  readonly page: Page;
  readonly counts: readonly Group[] | "overdue" | "open" | "low_stock";
  readonly tone: StatTone;
}

const TILES: readonly Tile[] = [
  { key: "unassigned", page: "dispatch", counts: ["unassigned_visit"], tone: "attention" },
  { key: "overdue", page: "tasks", counts: "overdue", tone: "warning" },
  { key: "open", page: "tasks", counts: "open", tone: "plain" },
  { key: "chats", page: "messages", counts: ["unanswered_chat"], tone: "attention" },
  { key: "lowStock", page: "stock", counts: "low_stock", tone: "attention" },
  { key: "charges", page: "payments", counts: ["no_show_decision", "no_show_dispute"], tone: "plain" },
];

function figureOf(tile: Tile, board: Tasks): number {
  if (tile.counts === "overdue") return board.overdue;
  if (tile.counts === "low_stock") return board.low_stock_places;
  if (tile.counts === "open") return board.groups.reduce((sum, each) => sum + each.count, 0);
  return countOf(board, tile.counts);
}

/** How many visits today's routes hold, once they have loaded. */
function VisitsToday() {
  const date = indiaDate(new Date().toISOString());
  const read = useCallback(() => todayApi.day(date), [date]);
  const [loaded] = useLoad(read);
  if (loaded.state !== "loaded") return null;
  const visits = loaded.value.technicians.reduce((sum, technician) => sum + technician.stops.length, 0);
  return <StatTile label={copy.tiles.visits} value={visits} to={sectionOf("dispatch").path} />;
}

function Figures({ board }: { board: Tasks }) {
  const mayCall = useMayCall();
  const mayRoute = useAccess().mayCall("GET /api/dispatch/day");
  const shown = TILES.filter((tile) => mayOpen(mayCall, tile.page));
  return (
    <Columns>
      {mayRoute && <VisitsToday />}
      {shown.map((tile) => {
        const figure = figureOf(tile, board);
        return (
          <StatTile
            key={tile.key}
            label={copy.tiles[tile.key]}
            value={figure}
            tone={figure > 0 ? tile.tone : "plain"}
            to={sectionOf(tile.page).path}
          />
        );
      })}
    </Columns>
  );
}

interface Waiting {
  readonly group: Group;
  readonly task: Task;
}

/** The tasks the person may act on, the longest overdue first, as many as one look takes in. */
const NEEDS_SHOWN = 10;

function needsOf(board: Tasks): Waiting[] {
  return board.groups
    .flatMap((group) => group.tasks.map((task) => ({ group: group.group, task })))
    .sort((one, other) => Date.parse(one.task.due) - Date.parse(other.task.due))
    .slice(0, NEEDS_SHOWN);
}

function Needs({ board }: { board: Tasks }) {
  const now = new Date();
  const needs = needsOf(board);
  return (
    <Panel titleId="needs" title={copy.needs} count={needs.length}>
      {needs.length === 0 ? (
        <EmptyState look="panel" line={copy.none} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th scope="col">{copy.who}</th>
              <th scope="col">{copy.what}</th>
              <th scope="col">{copy.due}</th>
            </tr>
          </thead>
          <tbody>
            {needs.map(({ group, task }) => {
              const subject = subjectOf(group, task);
              const where = decidedAt(group, task);
              return (
                <tr key={`${group} ${task.id}`}>
                  <td>
                    {task.person === null ? (
                      subject
                    ) : (
                      <OpsLink to={taskClientPath(group, task.person.id)}>{subject}</OpsLink>
                    )}
                  </td>
                  <td>
                    {where === null ? taskWords.groups[group] : <OpsLink to={where}>{taskWords.groups[group]}</OpsLink>}
                  </td>
                  <td>
                    <Left due={task.due} now={now} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

export function TodayScreen() {
  const board = useTaskBoard(true);
  if (board === null) return <Loading />;
  return (
    <Stack gap="24">
      <Figures board={board} />
      <Needs board={board} />
    </Stack>
  );
}
