// Requests › Concerns: what a client has said about how we use their data, raised in their app and answered here
// (docs/decisions/0049-dpdp.md). A row each, as the redesign draws them, opened in a drawer to answer. Recording the
// answer closes it and writes `grievance.resolve` to the audit log (ADR 0031); it messages nobody, since ops answer the
// client on the number shown.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { Field, TextArea } from "@maneman/ui/Field";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { EmptyState } from "@maneman/ui/EmptyState";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Panel } from "@maneman/ui/Panel";
import { RowHead } from "@maneman/ui/RowHead";
import { Table, TableScroll } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { Toast } from "@maneman/ui/Toast";
import { useLoad } from "@maneman/ui/useLoad";
import { rowId, useTargetRow } from "@maneman/ui/target";
import { firstShown } from "@maneman/ui/words";
import { longDate, shortDate, indiaDate } from "@maneman/web-kit/dates";
import { useEffect, useRef, useState } from "react";
import { type Grievance } from "../api.ts";
import { Reach } from "../clients/index.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { useHeaderSub } from "../frame/PageHead.tsx";
import { grievances } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Left } from "../lib/Left.tsx";
import { useHeadingAfter } from "../lib/heading-after.ts";
import { phoneWords } from "../lib/phone.ts";
import { clientPath } from "../route.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import styles from "./grievances.module.css";
import { Refusal } from "@maneman/ui/Refusal";
import { grievancesApi } from "./grievances-api.ts";
import { apiNow } from "@maneman/web-kit/clock";

/** Where a grievance is in its answer: open, sending, or refused by the API. */
type Answering =
  { readonly step: "open" } | { readonly step: "sending" } | { readonly step: "failed"; readonly code: string };

const copy = grievances.queue;
/** A row's kind in its id, as a task's link names it: "grievance-…". */
const ROW = "grievance";

interface AnswerProps {
  readonly each: Grievance;
  readonly now: Date;
  /** Whether the person's access lets them record the answer. */
  readonly mayAnswer: boolean;
  readonly onAnswered: () => void;
}

/** One concern opened: who raised it and when, the client's own words, and the answer that closes it. */
function Answer({ each, now, mayAnswer, onAnswered }: AnswerProps) {
  const [answering, setAnswering] = useState<Answering>({ step: "open" });
  const [response, setResponse] = useState("");

  const send = async () => {
    setAnswering({ step: "sending" });
    const answer = await grievancesApi.resolveGrievance(each.id, response.trim());
    if (answer.ok) onAnswered();
    else setAnswering({ step: "failed", code: answer.code });
  };

  const sending = answering.step === "sending";
  return (
    <>
      <div className={styles.head}>
        <OpsLink className={styles.name} to={clientPath(each.person_id, "consents")}>
          {each.name}
        </OpsLink>
        <Left due={each.due} now={now} />
      </div>
      <p className={styles.who}>{copy.raised(phoneWords(each.mobile), longDate(each.raised_at))}</p>
      <Reach name={each.name} mobile={each.mobile} />
      {/* The client's own words, kept apart from ours so nobody answers a paraphrase. */}
      <blockquote className={styles.words}>{each.text}</blockquote>
      {mayAnswer && (
        <div className={styles.answer}>
          <Field label={copy.label}>
            {(control) => (
              <TextArea
                {...control}
                className={styles.answerField}
                maxLength={2000}
                value={response}
                onChange={(event) => {
                  setResponse(event.target.value);
                }}
              />
            )}
          </Field>
          <div className={styles.actions}>
            <Button
              icon={ACTION_ICONS.send}
              variant="primary"
              size="small"
              disabled={sending || response.trim() === ""}
              onClick={() => void send()}
            >
              {sending ? copy.sending : copy.send}
            </Button>
          </div>
        </div>
      )}
      {answering.step === "failed" && (
        <Refusal className={styles.error} said={errorText(copy.errors, { code: answering.code })} />
      )}
    </>
  );
}

/** The concerns open, a row each: who raised it, what about, when, and how long is left to answer. */
function ConcernRows(props: { items: readonly Grievance[]; now: Date; onOpen: (id: string) => void }) {
  const [client, concern, raised, answerBy] = copy.columns;
  return (
    <TableScroll labelledBy="grievances">
      <Table>
        <thead>
          <tr>
            <th scope="col">{client}</th>
            <th scope="col">{concern}</th>
            <th scope="col">{raised}</th>
            <th scope="col">{answerBy}</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((each) => (
            <tr key={each.id} id={rowId(ROW, each.id)} tabIndex={-1}>
              <RowHead>
                <TextButton
                  compact
                  aria-label={copy.openLabel(each.name)}
                  onClick={() => {
                    props.onOpen(each.id);
                  }}
                >
                  {each.name}
                </TextButton>
              </RowHead>
              <td className={styles.concern}>{each.text}</td>
              <td>{shortDate(indiaDate(each.raised_at))}</td>
              <td>
                <span className={styles.due}>{shortDate(indiaDate(each.due))}</span>
                <Left due={each.due} now={props.now} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableScroll>
  );
}

export function GrievancesScreen() {
  const [loaded, retry] = useLoad(grievancesApi.grievances);
  const mayAnswer = useAccess().mayCall("POST /api/grievances/{id}/resolve");
  const [answered, setAnswered] = useState<readonly string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  // Keyed by how many were said, so the same words said again show again.
  const [said, setSaid] = useState<{ readonly words: string; readonly count: number } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useHeadingAfter(heading);
  const items = loaded.state === "loaded" ? loaded.value.grievances.filter((each) => !answered.includes(each.id)) : [];
  useHeaderSub(items.length === 0 ? undefined : copy.openCount(items.length));
  // A task links to its concern's row ("#grievance-…"), which opens it once the list is read.
  const target = useTargetRow(loaded.state === "loaded");
  useEffect(() => {
    if (loaded.state === "loaded" && target?.startsWith(`${ROW}-`) === true) setOpen(target.slice(ROW.length + 1));
  }, [loaded.state, target]);
  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const now = new Date(apiNow());
  const opened = items.find((each) => each.id === open) ?? null;
  const close = () => {
    setOpen(null);
  };
  return (
    // Titled as its page, so its heading is read, not shown again, and its count stands beside the page's title.
    <Panel titleId="grievances" title={grievances.title} count={items.length} headingRef={heading}>
      {items.length === 0 ? (
        <EmptyState look="panel" line={copy.empty} />
      ) : (
        <ConcernRows items={items} now={now} onOpen={setOpen} />
      )}
      {loaded.value.more && (
        <InlineMessage tone="note" className={styles.first}>
          {firstShown(loaded.value.grievances.length)}
        </InlineMessage>
      )}
      {said !== null && <Toast key={said.count}>{said.words}</Toast>}
      {opened !== null && (
        <FormDrawer title={opened.name} onClose={close}>
          <Answer
            each={opened}
            now={now}
            mayAnswer={mayAnswer}
            onAnswered={() => {
              setAnswered((already) => [...already, opened.id]);
              setSaid((was) => ({ words: copy.closed(opened.name), count: (was?.count ?? 0) + 1 }));
              focusHeading(opened.id);
              close();
            }}
          />
        </FormDrawer>
      )}
    </Panel>
  );
}
