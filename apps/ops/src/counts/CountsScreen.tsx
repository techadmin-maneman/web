// Operations · Counts (docs/decisions/0185-cycle-counts.md): the count tasks in the caller's places, each opened to be
// counted, counted again or signed off; and each item's count class.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { todayInIndia } from "@maneman/web-kit/dates";
import { Badge, type BadgeTone } from "@maneman/ui/Badge";
import { plainDate } from "@maneman/web-kit/plain-date";
import { Panel } from "@maneman/ui/Panel";
import { RowButton } from "@maneman/ui/Button";
import { EmptyState } from "@maneman/ui/EmptyState";
import { ACTIONS, RowActions, Table } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import form from "@maneman/ui/forms.module.css";
import { useLoad } from "@maneman/ui/useLoad";
import { useRowPanel, type RowOpener } from "@maneman/ui/useRowPanel";
import { useState } from "react";
import { counts as copy } from "../content/counts.ts";
import { useAccess } from "../lib/access.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { CountClasses, type CountTasks } from "./CountClasses.tsx";
import { CountTaskPanel, whatOf } from "./CountTask.tsx";
import { StartCount } from "./StartCount.tsx";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { RowHead } from "@maneman/ui/RowHead";
import { countsApi } from "./counts-api.ts";
import { apiNow } from "@maneman/web-kit/clock";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { PageActions, useHeaderSub } from "../frame/PageHead.tsx";
import styles from "./counts.module.css";

const loadTasks = () => countsApi.countTasks();

type CountTask = CountTasks["tasks"][number];

const [placeHead, whatHead, dueHead, statusHead] = copy.columns;

const COLUMNS: readonly Column<CountTask>[] = [
  { label: placeHead, sort: (task) => task.place, choice: (task) => task.place },
  { label: whatHead, sort: whatOf },
  { label: dueHead, sort: (task) => task.due_on },
  { label: statusHead, sort: (task) => copy.states[task.state], choice: (task) => copy.states[task.state] },
];

function Tasks({ countTasks, opener }: { countTasks: CountTasks; opener: RowOpener }) {
  const view = useTableView(countTasks.tasks, COLUMNS, { search: (task) => `${task.place} ${whatOf(task)}` });
  if (countTasks.tasks.length === 0) return <EmptyState look="panel" line={copy.none} />;
  return (
    <>
      <Narrowing view={view} label={copy.find} />
      <Table>
        <thead>
          <tr>
            <SortHeads view={view} />
            <th scope="col">
              <VisuallyHidden>{copy.next}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {view.shown.map((task) => (
            <tr key={task.id}>
              <RowHead>{task.place}</RowHead>
              <td>{whatOf(task)}</td>
              <td>
                {task.state !== "done" && task.due_on < todayInIndia(apiNow())
                  ? copy.overdue(plainDate(task.due_on))
                  : plainDate(task.due_on)}
              </td>
              <td>
                <Badge tone={STATE_TONES[task.state]}>{copy.states[task.state]}</Badge>
              </td>
              <td className={ACTIONS}>
                <RowActions>
                  <RowButton
                    icon={ACTION_ICONS.clipboardCheck}
                    aria-label={`${copy.act[task.state]} · ${copy.heading(task.place, whatOf(task))}`}
                    {...opener(task.id)}
                  >
                    {copy.act[task.state]}
                  </RowButton>
                </RowActions>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <TableEnd view={view} />
    </>
  );
}

/** To count is the work; waiting for a manager is to look at; done is calm. */
const STATE_TONES: Readonly<Record<CountTasks["tasks"][number]["state"], BadgeTone>> = {
  open: "attention",
  recount: "warning",
  sign_off: "attention",
  done: "done",
};

export function CountsScreen() {
  const [loaded, retry] = useLoad(loadTasks);
  const [countTasks, setCountTasks] = useState<CountTasks | null>(null);
  const { open, setOpen, panelId, opener } = useRowPanel();
  const access = useAccess();
  const current = countTasks ?? (loaded.state === "loaded" ? loaded.value : null);
  const due = current?.tasks.filter((task) => task.state !== "done").length ?? 0;
  useHeaderSub(due === 0 ? undefined : copy.due(due));
  // The list read again after a count changed: a failed read says so, with the way to read it again.
  const [rereadFailed, setRereadFailed] = useState<{ requestId: string | null } | null>(null);
  const reload = () => {
    void loadTasks().then((answer) => {
      setRereadFailed(answer.ok ? null : { requestId: answer.requestId });
      if (answer.ok) setCountTasks(answer.body);
    });
  };
  return (
    <>
      {loaded.state === "loading" && <PanelLoading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {rereadFailed !== null && <PanelFailed onRetry={reload} requestId={rereadFailed.requestId} />}
      {current !== null && (
        <div className={form.screen}>
          {access.mayCall("POST /api/count-tasks") && (
            <PageActions>
              <DrawerButton icon={ACTION_ICONS.clipboardCheck} label={copy.startTitle} primary>
                {(close) => (
                  <StartCount
                    countTasks={current}
                    onStarted={(id) => {
                      close();
                      setOpen(id);
                      reload();
                    }}
                  />
                )}
              </DrawerButton>
            </PageActions>
          )}
          <div className={styles.columns}>
            <Panel titleId="count-tasks" title={copy.tasks}>
              <Tasks countTasks={current} opener={opener} />
            </Panel>
            <CountClasses
              countTasks={current}
              mayChange={access.mayCall("POST /api/consumables/{code}/count-class")}
              onChanged={setCountTasks}
            />
          </div>
          {open !== null && (
            <CountTaskPanel
              key={open}
              id={open}
              panelId={panelId}
              onChanged={reload}
              onClose={() => {
                setOpen(null);
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
