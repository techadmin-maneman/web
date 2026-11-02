// Operations · Quality (docs/decisions/0187-recalls.md, 0188-failure-rates-and-value-at-risk.md): every recall, each
// opened to where its lot is and who wears it, and a lot recalled with why; failure rates; and the value at risk.

import { Toast } from "@maneman/ui/Toast";
import { indiaDate } from "@maneman/web-kit/dates";
import { plainDate } from "@maneman/web-kit/plain-date";
import { Badge } from "@maneman/ui/Badge";
import { TextButton } from "@maneman/ui/TextLink";
import { Panel } from "@maneman/ui/Panel";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Table } from "@maneman/ui/Table";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import { useLoad } from "@maneman/ui/useLoad";
import { useRowPanel, type RowOpener } from "@maneman/ui/useRowPanel";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import form from "@maneman/ui/forms.module.css";
import { quality as copy } from "../content/quality.ts";
import { useAccess } from "../lib/access.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { ExpiryRiskPanel } from "./ExpiryRisk.tsx";
import { FailuresPanel } from "./Failures.tsx";
import { RaiseRecall, RecallDetail, type Answer, type Quality, type Detail } from "./Recall.tsx";
import { Refusal } from "@maneman/ui/Refusal";
import { RowHead } from "@maneman/ui/RowHead";
import { qualityApi } from "./quality-api.ts";

const loadRecalls = () => qualityApi.recalls();

type Recalled = Quality["recalls"][number];

const [recallHead, itemHead, lotHead, raisedHead, statusHead] = copy.columns;
const standingOf = (recall: Recalled) => (recall.closed_at === null ? copy.open : copy.closed);

const COLUMNS: readonly Column<Recalled>[] = [
  { label: recallHead, sort: (recall) => recall.number },
  { label: itemHead, sort: (recall) => recall.name, choice: (recall) => recall.name },
  { label: lotHead, sort: (recall) => recall.lot_code },
  { label: raisedHead, sort: (recall) => recall.raised_at },
  { label: statusHead, sort: standingOf, choice: standingOf },
];

function Recalls({ quality, opener, onOpen }: { quality: Quality; opener: RowOpener; onOpen: (id: string) => void }) {
  const view = useTableView(quality.recalls, COLUMNS, {
    search: (recall) => `${copy.number(recall.number)} ${recall.name} ${recall.lot_code}`,
  });
  if (quality.recalls.length === 0) return <EmptyState look="panel" line={copy.none} />;
  return (
    <>
      <Narrowing view={view} label={copy.find} />
      <Table>
        <thead>
          <tr>
            <SortHeads view={view} />
          </tr>
        </thead>
        <tbody>
          {view.shown.map((recall) => (
            <tr key={recall.id}>
              <RowHead>
                <TextButton
                  compact
                  aria-label={copy.view(copy.number(recall.number))}
                  {...opener(recall.id, () => {
                    onOpen(recall.id);
                  })}
                >
                  {copy.number(recall.number)}
                </TextButton>
              </RowHead>
              <td>{recall.name}</td>
              <td>{recall.lot_code}</td>
              <td>{plainDate(indiaDate(recall.raised_at))}</td>
              <td>
                {recall.closed_at === null ? (
                  <Badge tone="attention">{copy.open}</Badge>
                ) : (
                  <Badge tone="done">{copy.closed}</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <TableEnd view={view} />
    </>
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
      {loaded.state === "loading" && <PanelLoading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {current !== null && (
        <div className={form.screen}>
          <Panel titleId="quality-recalls" title={copy.recalls}>
            <Recalls quality={current} opener={opener} onOpen={open} />
            {access.mayCall("POST /api/recalls") && <RaiseRecall quality={current} onAnswer={answered} />}
            {said !== null && <Toast>{said}</Toast>}
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
