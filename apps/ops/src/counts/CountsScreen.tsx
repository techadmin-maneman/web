// Operations · Counts (docs/decisions/0185-cycle-counts.md): the count tasks in the caller's places, each opened to be
// counted, counted again or signed off; and each item's count class.

import { fullDate } from "@maneman/web-kit/dates";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { useRowPanel, type RowOpener } from "@maneman/ui/useRowPanel";
import { useState } from "react";
import { client } from "../api.ts";
import form from "../components/forms.module.css";
import { counts as copy } from "../content/counts.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { CountClasses, type CountTasks } from "./CountClasses.tsx";
import { CountTaskPanel, whatOf } from "./CountTask.tsx";
import { StartCount } from "./StartCount.tsx";

const loadTasks = () => client.get("/api/count-tasks");

function Tasks({ countTasks, opener }: { countTasks: CountTasks; opener: RowOpener }) {
  if (countTasks.tasks.length === 0) return <p className={form.note}>{copy.none}</p>;
  return (
    <Table className={form.table}>
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
        {countTasks.tasks.map((task) => (
          <tr key={task.id}>
            <th scope="row" className={form.rowHead}>
              {task.place}
            </th>
            <td>{whatOf(task)}</td>
            <td>{fullDate(task.due_on)}</td>
            <td>{copy.states[task.state]}</td>
            <td>
              <Button
                variant="outline"
                size="small"
                aria-label={`${copy.open} ${copy.heading(task.place, whatOf(task))}`}
                {...opener(task.id)}
              >
                {copy.open}
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function CountsScreen() {
  const [loaded, retry] = useLoad(loadTasks);
  const [countTasks, setCountTasks] = useState<CountTasks | null>(null);
  const { open, setOpen, panelId, opener } = useRowPanel();
  const access = useAccess();
  const current = countTasks ?? (loaded.state === "loaded" ? loaded.value : null);
  const reload = () => {
    void loadTasks().then((answer) => {
      if (answer.ok) setCountTasks(answer.body);
    });
  };
  return (
    <>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
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
          {open !== null && <CountTaskPanel key={open} id={open} panelId={panelId} onChanged={reload} />}
          {access.mayCall("POST /api/consumables/{code}/count-class") && (
            <CountClasses countTasks={current} onChanged={setCountTasks} />
          )}
        </div>
      )}
    </>
  );
}
