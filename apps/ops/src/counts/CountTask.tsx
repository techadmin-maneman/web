// One count task (docs/decisions/0185-cycle-counts.md): counted blind, item by item; what differed counted again; and
// a recount that still differs signed off by a manager, who alone sees what the ledger held.

import { FormDrawer } from "../components/FormDrawer.tsx";
import { Toast } from "@maneman/ui/Toast";
import type { Success } from "@maneman/web-kit/api";
import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { counts as copy } from "../content/counts.ts";
import { stock } from "../content/stock.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { PieceScans } from "../stock/index.ts";
import { Refusal } from "../components/Refusal.tsx";
import { RowHead } from "../components/RowHead.tsx";
import { FormActions } from "../components/FormActions.tsx";
import { countsApi } from "./counts-api.ts";

type Task = Success<paths["/api/count-tasks/{id}"]["get"]>;

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

/** The step's note and button: a recount, a count, or a place that has since run out, which closes as counted. */
function stepWords(recount: boolean, items: number): { readonly note: string; readonly save: string } {
  if (recount) return { note: copy.recountNote, save: copy.saveRecount };
  if (items === 0) return { note: copy.nothingHere, save: copy.closeEmpty };
  return { note: copy.countNote, save: copy.saveCount };
}

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
    const answer = recount
      ? await countsApi.askRecount(task.task.id, body)
      : await countsApi.recordCounts(task.task.id, body);
    onAnswer(answer, recount ? copy.recountSaid : copy.countSaid);
  };
  const words = stepWords(recount, items.length);
  return (
    <div className={form.group}>
      <Note>{words.note}</Note>
      {items.map((item) => (
        <div key={item.consumable_code} className={form.group}>
          {item.labelled && (
            <>
              <Note>{copy.scanEach(item.name)}</Note>
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
                width="figure"
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
      <FormActions>
        <Button variant="primary" size="small" disabled={!ready} onClick={() => void save()}>
          {words.save}
        </Button>
      </FormActions>
    </div>
  );
}

/** What the ledger held beside both counts, and the sign-off with why: for a manager. */
function SignOff({ task, onAnswer }: { task: Task; onAnswer: (answer: Answer, said: () => string) => void }) {
  const load = useCallback(() => countsApi.differences(task.task.id), [task.task.id]);
  const [loaded, retry] = useLoad(load);
  const [note, setNote] = useState("");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  return (
    <div className={form.group}>
      <Table controls>
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
              <RowHead>{line.name}</RowHead>
              <td className={form.figure}>{stock.held(line.held, line.unit)}</td>
              <td className={form.figure}>{stock.held(line.counted, line.unit)}</td>
              <td className={form.figure}>{line.recounted === null ? "" : stock.held(line.recounted, line.unit)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {loaded.value.lines.map(
        (line) =>
          (line.missing_labels.length > 0 || line.unknown_labels.length > 0) && (
            <Note key={line.consumable_code}>
              {line.name}: {line.missing_labels.length > 0 && copy.notScanned(line.missing_labels)}{" "}
              {line.unknown_labels.length > 0 && copy.notHeld(line.unknown_labels)}
            </Note>
          ),
      )}
      <Field label={copy.why} className={form.field}>
        {(control) => (
          <TextInput
            {...control}
            width="figure"
            maxLength={200}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        )}
      </Field>
      <FormActions>
        <Button
          variant="primary"
          size="small"
          disabled={note.trim() === ""}
          onClick={() =>
            void countsApi.signOff(task.task.id, note.trim()).then((answer) => {
              onAnswer(answer, () => copy.signedSaid);
            })
          }
        >
          {copy.signOff}
        </Button>
      </FormActions>
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
  if (state === "done") return <Note>{copy.done}</Note>;
  if (state === "sign_off") {
    if (!access.mayCall("POST /api/count-tasks/{id}/sign-off")) return <Note>{copy.waiting}</Note>;
    return <SignOff task={task} onAnswer={onAnswer} />;
  }
  if (!access.mayCall("POST /api/count-tasks/{id}/counts")) return null;
  return <Counting key={state} task={task} onAnswer={onAnswer} />;
}

/** What a task counts: its one item, or its class. */
export const whatOf = (task: Task["task"]): string => task.item?.name ?? copy.classes[task.count_class];

export function CountTaskPanel({
  id,
  panelId,
  onChanged,
  onClose,
}: {
  id: string;
  panelId: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const load = useCallback(() => countsApi.countTask(id), [id]);
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
    <FormDrawer title={copy.heading(current.task.place, whatOf(current.task))} onClose={onClose}>
      <div id={panelId}>
        <Step task={current} onAnswer={answered} />
        {current.items.map(
          (item) =>
            item.unknown_labels.length > 0 && (
              <Note key={item.consumable_code}>
                {item.name}: {copy.notHeld(item.unknown_labels)}
              </Note>
            ),
        )}
        {said !== null && <Toast>{said}</Toast>}
        {failure !== null && <Refusal className={form.error} said={errorText(copy.errors, failure)} />}
      </div>
    </FormDrawer>
  );
}
