// Needs you, on each of Today's homes (ADR 0227): the person's board by kind, as the redesign draws it. Each kind says
// why it waits, how many wait and when the first is due; it opens Tasks on that kind, where each task's step is.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { Badge, type BadgeTone } from "@maneman/ui/Badge";
import { buttonLook } from "@maneman/ui/Button";
import { EmptyState } from "@maneman/ui/EmptyState";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { Panel } from "@maneman/ui/Panel";
import { apiNow } from "@maneman/web-kit/clock";
import { indiaDate } from "@maneman/web-kit/dates";
import { quantity } from "@maneman/web-kit/figures";
import type { TaskGroup, Tasks } from "../api.ts";
import { tasks as taskWords } from "../content.ts";
import { today as copy } from "../content/today.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { sectionOf } from "../route.ts";
import { kindPath } from "../tasks/index.ts";
import styles from "./today.module.css";

type Group = TaskGroup["group"];
type Due = keyof typeof taskWords.due;

/** As many kinds as one look takes in. */
const NEEDS_SHOWN = 10;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** When a kind's first task is due, as its pill says it: overdue, today, within the week, or later. */
function dueOf(first: string, now: Date): Due {
  const at = Date.parse(first);
  if (at < now.getTime()) return "overdue";
  if (indiaDate(first) === indiaDate(now.toISOString())) return "today";
  return at - now.getTime() < WEEK_MS ? "week" : "later";
}

const TONES: Readonly<Record<Due, BadgeTone>> = {
  overdue: "warning",
  today: "attention",
  week: "neutral",
  later: "neutral",
};

interface Kind {
  readonly group: Group;
  readonly count: number;
  /** When its first task is due. */
  readonly first: string;
}

/** The board's kinds with something waiting, the soonest due first. */
function kindsOf(board: Tasks): Kind[] {
  return board.groups
    .flatMap((group) => {
      const [first] = group.tasks.map((task) => task.due).sort((one, other) => Date.parse(one) - Date.parse(other));
      return group.count > 0 && first !== undefined ? [{ group: group.group, count: group.count, first }] : [];
    })
    .sort((one, other) => Date.parse(one.first) - Date.parse(other.first))
    .slice(0, NEEDS_SHOWN);
}

function KindRow({ kind, now }: { readonly kind: Kind; readonly now: Date }) {
  const due = dueOf(kind.first, now);
  return (
    <ListRow
      title={taskWords.groups[kind.group]}
      meta={taskWords.why[kind.group]}
      end={
        <span className={styles.kindEnd}>
          <span className={styles.kindCount}>{quantity(kind.count)}</span>
          <Badge tone={TONES[due]}>{taskWords.due[due]}</Badge>
        </span>
      }
      to={kindPath(kind.group)}
    />
  );
}

export function Needs({ board }: { readonly board: Tasks }) {
  const now = new Date(apiNow());
  const kinds = kindsOf(board);
  const count = board.groups.reduce((sum, group) => sum + group.count, 0);
  return (
    <Panel
      titleId="needs"
      title={copy.needs}
      actions={
        <>
          <span className={styles.open}>{taskWords.openCount(count)}</span>
          <OpsLink
            to={sectionOf("tasks").path}
            className={buttonLook({ variant: "outline", size: "small", iconOnly: true })}
            icon={ACTION_ICONS.arrowUpRight}
          >
            {copy.allTasks}
          </OpsLink>
        </>
      }
    >
      {kinds.length === 0 ? (
        <EmptyState look="panel" line={copy.none} />
      ) : (
        <ListRows inPanel>
          {kinds.map((kind) => (
            <KindRow key={kind.group} kind={kind} now={now} />
          ))}
        </ListRows>
      )}
    </Panel>
  );
}
