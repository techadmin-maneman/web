// Operations · Counts (docs/decisions/0185-cycle-counts.md): the count tasks in the caller's places, each opened to be
// counted, counted again or signed off; and each item's count class.

import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { client } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import form from "../components/forms.module.css";
import { counts as copy } from "../content/counts.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { CountClasses, type Book } from "./CountClasses.tsx";
import { CountTaskPanel } from "./CountTask.tsx";

const loadTasks = () => client.get("/api/count-tasks");

function Tasks({ book, onOpen }: { book: Book; onOpen: (id: string) => void }) {
  if (book.tasks.length === 0) return <p className={form.note}>{copy.none}</p>;
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
        {book.tasks.map((task) => (
          <tr key={task.id}>
            <th scope="row" className={form.rowHead}>
              {task.place}
            </th>
            <td>{copy.classes[task.count_class] ?? task.count_class}</td>
            <td>{task.due_on}</td>
            <td>{copy.states[task.state] ?? task.state}</td>
            <td>
              <Button
                variant="outline"
                size="small"
                aria-label={`${copy.open} ${copy.heading(task.place, copy.classes[task.count_class] ?? task.count_class)}`}
                onClick={() => {
                  onOpen(task.id);
                }}
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
  const [book, setBook] = useState<Book | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const access = useAccess();
  const current = book ?? (loaded.state === "loaded" ? loaded.value : null);
  const reload = () => {
    void loadTasks().then((answer) => {
      if (answer.ok) setBook(answer.body);
    });
  };
  return (
    <Shell section="/counts" title={copy.title}>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {current !== null && (
        <div className={form.screen}>
          <section className={form.panel} aria-labelledby="count-tasks">
            <div className={form.panelHead}>
              <h2 className={form.panelTitle} id="count-tasks">
                {copy.tasks}
              </h2>
            </div>
            <Tasks book={current} onOpen={setOpen} />
          </section>
          {open !== null && <CountTaskPanel key={open} id={open} onChanged={reload} />}
          {access.mayCall("POST /api/consumables/{code}/count-class") && (
            <CountClasses book={current} onBook={setBook} />
          )}
        </div>
      )}
    </Shell>
  );
}
