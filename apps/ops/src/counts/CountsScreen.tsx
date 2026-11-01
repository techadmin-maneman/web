// Operations · Counts (docs/decisions/0185-cycle-counts.md): the count tasks in the caller's places, each opened to be
// counted, counted again or signed off; and each item's count class.

import { todayInIndia } from "@maneman/web-kit/dates";
import { Badge, type BadgeTone } from "@maneman/ui/Badge";
import { plainDate } from "@maneman/web-kit/plain-date";
import { Panel } from "@maneman/ui/Panel";
import { TextButton } from "@maneman/ui/TextLink";
import { Note } from "@maneman/ui/Note";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { useRowPanel, type RowOpener } from "@maneman/ui/useRowPanel";
import { useState } from "react";
import form from "@maneman/ui/forms.module.css";
import { counts as copy } from "../content/counts.ts";
import { useAccess } from "../lib/access.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { CountClasses, type CountTasks } from "./CountClasses.tsx";
import { CountTaskPanel, whatOf } from "./CountTask.tsx";
import { StartCount } from "./StartCount.tsx";
import { ListTools } from "@maneman/ui/ListTools";
import { RowHead } from "@maneman/ui/RowHead";
import { countsApi } from "./counts-api.ts";
import { apiNow } from "@maneman/web-kit/clock";

const loadTasks = () => countsApi.countTasks();

function Tasks({ countTasks, opener }: { countTasks: CountTasks; opener: RowOpener }) {
  if (countTasks.tasks.length === 0) return <Note>{copy.none}</Note>;
  return (
    <ListTools rows={countTasks.tasks} textOf={(task) => `${task.place} ${whatOf(task)}`} label={copy.find}>
      {(shown) => (
        <Table controls>
          <thead>
            <tr>
              {copy.columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((task) => (
              <tr key={task.id}>
                <RowHead>
                  <TextButton
                    compact
                    aria-label={`${copy.open} ${copy.heading(task.place, whatOf(task))}`}
                    {...opener(task.id)}
                  >
                    {task.place}
                  </TextButton>
                </RowHead>
                <td>{whatOf(task)}</td>
                <td>
                  {task.state !== "done" && task.due_on < todayInIndia(apiNow())
                    ? copy.overdue(plainDate(task.due_on))
                    : plainDate(task.due_on)}
                </td>
                <td>
                  <Badge tone={STATE_TONES[task.state]}>{copy.states[task.state]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </ListTools>
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
          <Panel titleId="count-tasks" title={copy.tasks}>
            <Tasks countTasks={current} opener={opener} />
          </Panel>
          {access.mayCall("POST /api/count-tasks") && (
            <StartCount
              countTasks={current}
              onStarted={(id) => {
                setOpen(id);
                reload();
              }}
            />
          )}
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
          {access.mayCall("POST /api/consumables/{code}/count-class") && (
            <CountClasses countTasks={current} onChanged={setCountTasks} />
          )}
        </div>
      )}
    </>
  );
}
