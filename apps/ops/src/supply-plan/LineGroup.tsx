// A run of the supply plan's lines that go to one place or come from one supplier (./SupplyPlanScreen.tsx): its head
// names where and how many, and approves every line still to decide at the quantity proposed, once asked.

import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState, type ReactNode } from "react";
import { CheckPanel } from "../components/CheckPanel.tsx";
import { supplyPlan as copy } from "../content/supply-plan.ts";
import { useAccess } from "../lib/access.ts";
import type { Answer, Line } from "./PlanLine.tsx";
import styles from "./supply-plan.module.css";
import { supplyPlanApi } from "./supply-plan-api.ts";

/** Each line approved in turn, stopping at the first refused: what the last answered. */
async function approvedAll(lines: readonly Line[]): Promise<Answer | null> {
  let last: Answer | null = null;
  for (const line of lines) {
    last = await supplyPlanApi.approveLine(line.id, line.proposed);
    if (!last.ok) return last;
  }
  return last;
}

export function LineGroup(props: {
  readonly where: string;
  readonly lines: readonly Line[];
  readonly columns: number;
  readonly onAnswer: (answer: Answer, said: string) => void;
  readonly children: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, once] = useOneAtATime();
  const mayApprove = useAccess().mayCall("POST /api/supply-plan/lines/{id}/approve");
  const open = props.lines.filter((line) => line.state === "proposed");
  const approve = () =>
    once(async () => {
      const answer = await approvedAll(open);
      setAsking(false);
      if (answer !== null) props.onAnswer(answer, copy.group.approved(open.length));
    });
  return (
    <tbody>
      <tr className={styles.groupHead}>
        <th scope="colgroup" colSpan={props.columns}>
          <span className={styles.groupTitle}>{copy.group.title(props.where, props.lines.length)}</span>
          {mayApprove && open.length > 1 && !asking && (
            <Button
              variant="outline"
              size="small"
              narrow
              onClick={() => {
                setAsking(true);
              }}
            >
              {copy.group.approveAll(open.length)}
            </Button>
          )}
        </th>
      </tr>
      {asking && (
        <tr>
          <td colSpan={props.columns}>
            <CheckPanel
              question={copy.group.check(open.length, props.where)}
              busy={busy}
              onSend={() => void approve()}
              onBack={() => {
                setAsking(false);
              }}
            />
          </td>
        </tr>
      )}
      {props.children}
    </tbody>
  );
}
