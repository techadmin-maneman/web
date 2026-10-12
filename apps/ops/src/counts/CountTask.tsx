// One count task (docs/decisions/0185-cycle-counts.md): counted blind, item by item; what differed counted again; and
// a recount that still differs signed off by a manager, who alone sees what the ledger held.

import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { counts as copy } from "../content/counts.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";

type Task = paths["/api/count-tasks/{id}"]["get"]["responses"][200]["content"]["application/json"];

type Answer =
  | { readonly ok: true; readonly body: Task }
  | { readonly ok: false; readonly code: string; readonly fields: readonly string[] };

/** Each item's box, blind: the figure typed, never the ledger's. */
function Counting({
  task,
  onAnswer,
}: {
  task: Task;
  onAnswer: (answer: Answer, said: (waiting: number) => string) => void;
}) {
  const recount = task.task.state === "recount";
  const items = task.items.filter((item) => item.state === (recount ? "recount" : "to_count"));
  const [figures, setFigures] = useState<Readonly<Record<string, string>>>({});
  const ready = items.every((item) => /^\d+$/.test(figures[item.consumable_code] ?? ""));
  const save = async () => {
    const body = {
      lines: items.map((item) => ({
        consumable_code: item.consumable_code,
        counted: Number(figures[item.consumable_code]),
      })),
    };
    const path = { path: { id: task.task.id } };
    const answer = recount
      ? await client.post("/api/count-tasks/{id}/recounts", { ...path, body })
      : await client.post("/api/count-tasks/{id}/counts", { ...path, body });
    onAnswer(answer, recount ? copy.recountSaid : copy.countSaid);
  };
  return (
    <div className={form.group}>
      <p className={form.note}>{recount ? copy.recountNote : copy.countNote}</p>
      {items.map((item) => (
        <Field key={item.consumable_code} label={copy.counted(item.name)} className={form.field}>
          {(control) => (
            <TextInput
              {...control}
              inputMode="numeric"
              value={figures[item.consumable_code] ?? ""}
              onChange={(event) => {
                setFigures((was) => ({ ...was, [item.consumable_code]: event.target.value }));
              }}
            />
          )}
        </Field>
      ))}
      <div className={form.actions}>
        <Button variant="primary" size="small" disabled={!ready} onClick={() => void save()}>
          {recount ? copy.saveRecount : copy.saveCount}
        </Button>
      </div>
    </div>
  );
}

/** What the ledger held beside both counts, and the sign-off with why: for a manager. */
function SignOff({ task, onAnswer }: { task: Task; onAnswer: (answer: Answer, said: () => string) => void }) {
  const load = useCallback(
    () => client.get("/api/count-tasks/{id}/differences", { path: { id: task.task.id } }),
    [task.task.id],
  );
  const [loaded, retry] = useLoad(load);
  const [note, setNote] = useState("");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  return (
    <div className={form.group}>
      <Table className={form.table}>
        <thead>
          <tr>
            {copy.differencesColumns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loaded.value.lines.map((line) => (
            <tr key={line.consumable_code}>
              <th scope="row" className={form.rowHead}>
                {line.name}
              </th>
              <td className={form.figure}>{line.held}</td>
              <td className={form.figure}>{line.counted}</td>
              <td className={form.figure}>{line.recounted ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Field label={copy.why} className={form.field}>
        {(control) => (
          <TextInput
            {...control}
            maxLength={200}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        )}
      </Field>
      <div className={form.actions}>
        <Button
          variant="primary"
          size="small"
          disabled={note.trim() === ""}
          onClick={() =>
            void client
              .post("/api/count-tasks/{id}/sign-off", { path: { id: task.task.id }, body: { note: note.trim() } })
              .then((answer) => {
                onAnswer(answer, () => copy.signedSaid);
              })
          }
        >
          {copy.signOff}
        </Button>
      </div>
    </div>
  );
}

function Step({
  task,
  onAnswer,
}: {
  task: Task;
  onAnswer: (answer: Answer, said: (waiting: number) => string) => void;
}) {
  const access = useAccess();
  const { state } = task.task;
  if (state === "done") return <p className={form.note}>{copy.done}</p>;
  if (state === "sign_off") {
    if (!access.mayCall("POST /api/count-tasks/{id}/sign-off")) return <p className={form.note}>{copy.waiting}</p>;
    return <SignOff task={task} onAnswer={onAnswer} />;
  }
  if (!access.mayCall("POST /api/count-tasks/{id}/counts")) return null;
  return <Counting key={state} task={task} onAnswer={onAnswer} />;
}

export function CountTaskPanel({ id, onChanged }: { id: string; onChanged: () => void }) {
  const load = useCallback(() => client.get("/api/count-tasks/{id}", { path: { id } }), [id]);
  const [loaded, retry] = useLoad(load);
  const [task, setTask] = useState<Task | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const current = task ?? (loaded.state === "loaded" ? loaded.value : null);
  const answered = (answer: Answer, words: (waiting: number) => string) => {
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      return;
    }
    setTask(answer.body);
    setSaid(words(answer.body.items.filter((item) => item.state !== "settled").length));
    setFailure(null);
    onChanged();
  };
  return (
    <section className={form.panel} aria-labelledby="count-task">
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {current !== null && (
        <>
          <div className={form.panelHead}>
            <h2 className={form.panelTitle} id="count-task">
              {copy.heading(current.task.place, copy.classes[current.task.count_class] ?? current.task.count_class)}
            </h2>
          </div>
          <Step task={current} onAnswer={answered} />
        </>
      )}
      {said !== null && (
        <p className={form.saved} role="status">
          {said}
        </p>
      )}
      {failure !== null && (
        <p className={form.error} role="alert">
          {errorText(copy.errors, failure)}
        </p>
      )}
    </section>
  );
}
