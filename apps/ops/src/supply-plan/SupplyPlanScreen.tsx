// Operations · Supply plan (docs/decisions/0180-supply-plan.md): the latest draft's transfers, by city, and orders, by
// supplier, each with the figures behind it, approved at a quantity or rejected with why; and the plan drafted again
// from the latest forecast. Beneath, the forecast itself and the events calendar it reads.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { client } from "../api.ts";
import form from "../components/forms.module.css";
import { supplyPlan as copy } from "../content/supply-plan.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { PlanLineSteps, type Answer, type Line, type Plan } from "./PlanLine.tsx";
import { Planning } from "./Planning.tsx";
import { Refusal } from "../components/Refusal.tsx";
import { FormActions } from "../components/FormActions.tsx";
import { RowHead } from "../components/RowHead.tsx";

const loadPlan = () => client.get("/api/supply-plan");

function Lines({
  lines,
  kind,
  onAnswer,
}: {
  lines: readonly Line[];
  kind: "transfer" | "order";
  onAnswer: (answer: Answer, said: string) => void;
}) {
  const shown = lines.filter((line) => line.kind === kind);
  const columns = kind === "transfer" ? copy.transferColumns : copy.orderColumns;
  if (shown.length === 0) return null;
  return (
    <Panel titleId={`plan-${kind}`} title={kind === "transfer" ? copy.transfers : copy.orders}>
      <Table className={form.table}>
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
            <tr key={line.id}>
              <RowHead>
                {line.name}
                <p className={form.note}>{copy.why(line)}</p>
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
              <td className={form.figure}>{line.quantity ?? line.proposed}</td>
              <td>
                <PlanLineSteps line={line} onAnswer={onAnswer} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
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
          {current.lines.length === 0 && <p className={form.note}>{copy.none}</p>}
          <Lines lines={current.lines} kind="transfer" onAnswer={answered} />
          <Lines lines={current.lines} kind="order" onAnswer={answered} />
          {said !== null && (
            <InlineMessage tone="saved" className={form.saved}>
              {said}
            </InlineMessage>
          )}
          {failure !== null && <Refusal className={form.error} said={errorText(copy.errors, failure)} />}
          {access.mayCall("POST /api/supply-plan/draft") && (
            <FormActions>
              <Button
                variant="outline"
                size="small"
                onClick={() =>
                  void client.post("/api/supply-plan/draft").then((answer) => {
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
