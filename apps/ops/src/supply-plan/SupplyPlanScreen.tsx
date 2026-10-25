// Operations · Supply plan (docs/decisions/0180-supply-plan.md): the latest draft's transfers, by city, and orders, by
// supplier, each with the figures behind it, approved at a quantity or rejected with why; and the plan drafted again
// from the latest forecast. Beneath, the forecast itself and the events calendar it reads.

import { Toast } from "@maneman/ui/Toast";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Note } from "@maneman/ui/Note";
import { Table } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import form from "../components/forms.module.css";
import { stock } from "../content/stock.ts";
import { supplyPlan as copy } from "../content/supply-plan.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { LineState, PlanLineSteps, type Answer, type Line, type Plan } from "./PlanLine.tsx";
import { Planning } from "./Planning.tsx";
import { Refusal } from "../components/Refusal.tsx";
import { FormActions } from "../components/FormActions.tsx";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { ListTools } from "../components/ListTools.tsx";
import { RowHead } from "../components/RowHead.tsx";
import styles from "./supply-plan.module.css";
import { supplyPlanApi } from "./supply-plan-api.ts";

const loadPlan = () => supplyPlanApi.plan();

/** One line in its table: its item, which opens the line to decide, why it is there, where it goes, and how it stands. */
function LineRow({ line, kind, onOpen }: { line: Line; kind: "transfer" | "order"; onOpen: () => void }) {
  return (
    <tr>
      <RowHead>
        <TextButton compact aria-label={copy.openLine(line.name)} onClick={onOpen}>
          {line.name}
        </TextButton>
        <span className={styles.why}>{copy.why(line)}</span>
      </RowHead>
      {kind === "transfer" ? (
        <>
          <td>{line.from ?? ""}</td>
          <td>{line.to ?? ""}</td>
        </>
      ) : (
        <td>{line.supplier ?? ""}</td>
      )}
      <td>{line.city ?? copy.everyCity}</td>
      <td className={form.figure}>{stock.held(line.quantity ?? line.proposed, line.unit)}</td>
      <td>
        <LineState line={line} />
      </td>
    </tr>
  );
}

function Lines({
  lines,
  kind,
  onAnswer,
}: {
  lines: readonly Line[];
  kind: "transfer" | "order";
  onAnswer: (answer: Answer, said: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const ofKind = lines.filter((line) => line.kind === kind);
  const columns = kind === "transfer" ? copy.transferColumns : copy.orderColumns;
  const opened = ofKind.find((line) => line.id === open);
  if (ofKind.length === 0) return null;
  return (
    <Panel titleId={`plan-${kind}`} title={kind === "transfer" ? copy.transfers : copy.orders}>
      <ListTools
        rows={ofKind}
        textOf={(line) => [line.name, line.from, line.to, line.supplier, line.city].join(" ")}
        label={copy.find}
      >
        {(shown) => (
          <Table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((line) => (
                <LineRow
                  key={line.id}
                  line={line}
                  kind={kind}
                  onOpen={() => {
                    setOpen(line.id);
                  }}
                />
              ))}
            </tbody>
          </Table>
        )}
      </ListTools>
      {opened !== undefined && (
        <FormDrawer
          title={opened.name}
          onClose={() => {
            setOpen(null);
          }}
        >
          <Note>{copy.why(opened)}</Note>
          <PlanLineSteps
            line={opened}
            onAnswer={(answer, said) => {
              onAnswer(answer, said);
              if (answer.ok) setOpen(null);
            }}
          />
        </FormDrawer>
      )}
    </Panel>
  );
}

export function SupplyPlanScreen() {
  const [loaded, retry] = useLoad(loadPlan);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const access = useAccess();
  const current = plan ?? (loaded.state === "loaded" ? loaded.value : null);
  const answered = (answer: Answer, words: string) => {
    if (answer.ok) {
      setPlan(answer.body);
      setSaid(words);
      setFailure(null);
    } else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {current !== null && (
        <div className={form.screen}>
          {current.lines.length === 0 && <Note>{copy.none}</Note>}
          <Lines lines={current.lines} kind="transfer" onAnswer={answered} />
          <Lines lines={current.lines} kind="order" onAnswer={answered} />
          {said !== null && <Toast>{said}</Toast>}
          {failure !== null && <Refusal className={form.error} said={errorText(copy.errors, failure)} />}
          {access.mayCall("POST /api/supply-plan/draft") && (
            <FormActions>
              <Button
                variant="outline"
                size="small"
                onClick={() =>
                  void supplyPlanApi.draftPlan().then((answer) => {
                    answered(answer, copy.drafted);
                  })
                }
              >
                {copy.draft}
              </Button>
            </FormActions>
          )}
          <Planning />
        </div>
      )}
    </>
  );
}
