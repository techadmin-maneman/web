// Operations · Quality (docs/decisions/0187-recalls.md, 0188-failure-rates-and-value-at-risk.md): every recall, each
// opened to where its lot is and who wears it, and a lot recalled with why; failure rates; and the value at risk.

import { longDate } from "@maneman/web-kit/dates";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { useRowPanel, type RowOpener } from "@maneman/ui/useRowPanel";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import form from "../components/forms.module.css";
import { quality as copy } from "../content/quality.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { ExpiryRiskPanel } from "./ExpiryRisk.tsx";
import { FailuresPanel } from "./Failures.tsx";
import { RaiseRecall, RecallDetail, type Answer, type Quality, type Detail } from "./Recall.tsx";
import { Refusal } from "../components/Refusal.tsx";
import { RowHead } from "../components/RowHead.tsx";
import { qualityApi } from "./quality-api.ts";

const loadRecalls = () => qualityApi.recalls();

function Recalls({ quality, opener, onOpen }: { quality: Quality; opener: RowOpener; onOpen: (id: string) => void }) {
  if (quality.recalls.length === 0) return <p className={form.note}>{copy.none}</p>;
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
        {quality.recalls.map((recall) => (
          <tr key={recall.id}>
            <RowHead>{copy.number(recall.number)}</RowHead>
            <td>{recall.name}</td>
            <td>{recall.lot_code}</td>
            <td>{longDate(recall.raised_at)}</td>
            <td>{recall.closed_at === null ? copy.open : copy.closed}</td>
            <td>
              <Button
                variant="outline"
                size="small"
                aria-label={copy.view(copy.number(recall.number))}
                {...opener(recall.id, () => {
                  onOpen(recall.id);
                })}
              >
                {copy.viewShort}
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function QualityScreen() {
  const [loaded, retry] = useLoad(loadRecalls);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [opened, setOpened] = useState<Detail | null>(null);
  const { open: openId, setOpen, panelId, opener } = useRowPanel();
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const access = useAccess();
  const current = quality ?? (loaded.state === "loaded" ? loaded.value : null);
  const reload = () => {
    void loadRecalls().then((answer) => {
      if (answer.ok) setQuality(answer.body);
    });
  };
  const answered = (answer: Answer, words: string) => {
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      return;
    }
    setOpened(answer.body);
    setOpen(answer.body.id);
    setSaid(words);
    setFailure(null);
    reload();
  };
  const open = (id: string) => {
    void qualityApi.recall(id).then((answer) => {
      if (answer.ok) setOpened(answer.body);
    });
  };
  return (
    <>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {current !== null && (
        <div className={form.screen}>
          <Panel titleId="quality-recalls" title={copy.recalls}>
            <Recalls quality={current} opener={opener} onOpen={open} />
            {access.mayCall("POST /api/recalls") && <RaiseRecall quality={current} onAnswer={answered} />}
            {said !== null && (
              <InlineMessage tone="saved" className={form.saved}>
                {said}
              </InlineMessage>
            )}
            {failure !== null && <Refusal className={form.error} said={errorText(copy.errors, failure)} />}
          </Panel>
          {opened !== null && opened.id === openId && (
            <RecallDetail key={opened.id} id={panelId} recall={opened} onAnswer={answered} />
          )}
          <FailuresPanel />
          {access.mayCall("GET /api/stock/expiry-risk") && <ExpiryRiskPanel />}
        </div>
      )}
    </>
  );
}
