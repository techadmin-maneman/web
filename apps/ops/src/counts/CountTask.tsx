// One count task (docs/decisions/0185-cycle-counts.md): counted blind, item by item; what differed counted again; and
// a recount that still differs signed off by a manager, who alone sees what the ledger held.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
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
import { PieceScans } from "../stock/index.ts";

type Task = paths["/api/count-tasks/{id}"]["get"]["responses"][200]["content"]["application/json"];

type Item = Task["items"][number];

/** What one item's line sends: its figure, and the labels scanned where the place holds it under labels. */
function lineOf(item: Item, figure: string, labels: readonly string[]) {
  if (!item.labelled) return { consumable_code: item.consumable_code, counted: Number(figure) };
  const unlabelled = figure === "" ? 0 : Number(figure);
  return { consumable_code: item.consumable_code, counted: labels.length + unlabelled, labels: [...labels] };
}

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
  const [scans, setScans] = useState<Readonly<Record<string, readonly string[]>>>({});
  // A labelled item's figure counts only its pieces with no label, and may be left empty.
  const ready = items.every((item) => /^\d+$/.test(figures[item.consumable_code] ?? (item.labelled ? "0" : "")));
  const save = async () => {
    const body = {
      lines: items.map((item) => lineOf(item, figures[item.consumable_code] ?? "", scans[item.consumable_code] ?? [])),
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
        <div key={item.consumable_code} className={form.group}>
          {item.labelled && (
            <>
              <p className={form.note}>{copy.scanEach(item.name)}</p>
              <PieceScans
                units={scans[item.consumable_code] ?? []}
                onUnits={(units) => {
                  setScans((was) => ({ ...was, [item.consumable_code]: units }));
                }}
              />
            </>
          )}
          <Field label={item.labelled ? copy.unlabelled(item.name) : copy.counted(item.name)} className={form.field}>
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
        </div>
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
      {loaded.value.lines.map(
        (line) =>
          (line.missing_labels.length > 0 || line.unknown_labels.length > 0) && (
            <p className={form.note} key={line.consumable_code}>
              {line.name}: {line.missing_labels.length > 0 && copy.notScanned(line.missing_labels)}{" "}
              {line.unknown_labels.length > 0 && copy.notHeld(line.unknown_labels)}
            </p>
          ),
      )}
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

/** What a task counts: its one item, or its class. */
export const whatOf = (task: Task["task"]): string => task.item?.name ?? copy.classes[task.count_class];

export function CountTaskPanel({ id, panelId, onChanged }: { id: string; panelId: string; onChanged: () => void }) {
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
  if (current === null) {
    return loaded.state === "failed" ? <PanelFailed onRetry={retry} requestId={loaded.requestId} /> : <Loading />;
  }
  return (
    <Panel id={panelId} opened titleId="count-task" title={copy.heading(current.task.place, whatOf(current.task))}>
      <Step task={current} onAnswer={answered} />
      {current.items.map(
        (item) =>
          item.unknown_labels.length > 0 && (
            <p className={form.note} key={item.consumable_code}>
              {item.name}: {copy.notHeld(item.unknown_labels)}
            </p>
          ),
      )}
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
      {failure !== null && (
        <InlineMessage tone="error" className={form.error}>
          {errorText(copy.errors, failure)}
        </InlineMessage>
      )}
    </Panel>
  );
}
