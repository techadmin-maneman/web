// What happened on a visit, under its facts in its drawer (./BlockDrawer.tsx): each step the technician took, when and
// by whom, how it ended, and a way to the client's photographs. Read when the drawer opens. A landed step can be sent
// back to the technician with why, and says so until they do it again (docs/decisions/0246-closed-and-sent-back.md).

import { useLoad } from "@maneman/ui/useLoad";
import { PanelFailed } from "@maneman/ui/States";
import { indiaClock } from "@maneman/web-kit/dates";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Button } from "@maneman/ui/Button";
import { useCallback, useState } from "react";
import { OpsLink } from "../frame/Shell.tsx";
import { dispatch } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { rowPath } from "@maneman/ui/target";
import { clientPath, sectionOf } from "../route.ts";
import styles from "./dispatch.module.css";
import { dispatchApi, type SentBackKind } from "./dispatch-api.ts";
import { SendBackForm } from "./SendBack.tsx";
import type { components } from "../api-schema.ts";

const copy = dispatch.drawer.story;

type Step = components["schemas"]["VisitStory"]["steps"][number];

/** A step's line: when, what, by whom, and, on its last landing, why it was sent back or the way to send it back. */
function StepLine(props: {
  visitId: string;
  step: Step;
  last: boolean;
  sentBack: string | null;
  mayCall: boolean;
  onSent: () => void;
}) {
  const { step } = props;
  const [asking, setAsking] = useState(false);
  const kind = step.kind as SentBackKind;
  return (
    <li className={styles.storyStep}>
      <span className={styles.storyTime}>{indiaClock(step.at)}</span>
      <span className={styles.storyWhat}>
        <span>
          {copy.step(
            copy.steps[step.kind] ?? step.kind,
            step.outcome === null ? undefined : copy.outcomes[step.outcome],
          )}
          {step.technician !== null && <span className={styles.storyBy}> · {step.technician}</span>}
          {step.door?.note !== undefined && step.door.note !== null && (
            <span className={styles.storyBy}> · {copy.doorNote(step.door.note)}</span>
          )}
          {step.door?.photo === true && (
            <>
              {" · "}
              <OpsLink to={rowPath(sectionOf("payments").path, "case", step.door.case_id)}>{copy.doorPhoto}</OpsLink>
            </>
          )}
        </span>
        {props.last && props.sentBack !== null && (
          <InlineMessage tone="note">{copy.sendBack.sent(props.sentBack)}</InlineMessage>
        )}
        {props.last && props.mayCall && !asking && (
          <Button
            variant="quiet"
            size="small"
            narrow
            onClick={() => {
              setAsking(true);
            }}
          >
            {copy.sendBack.action}
          </Button>
        )}
        {asking && (
          <SendBackForm
            visitId={props.visitId}
            kind={kind}
            onSent={props.onSent}
            onCancel={() => {
              setAsking(false);
            }}
          />
        )}
      </span>
    </li>
  );
}

export function VisitStory({ visitId, clientId }: { visitId: string; clientId: string | null }) {
  const read = useCallback(() => dispatchApi.story(visitId), [visitId]);
  const [loaded, retry] = useLoad(read);
  const access = useAccess();
  const mayRead = access.mayCall("GET /api/visits/{id}/story");
  const maySendBack = access.mayCall("POST /api/visits/{id}/send-back");
  if (!mayRead || loaded.state === "loading") return null;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const { steps, sent_back: sentBack, may_send_back: mayBack } = loaded.value;
  const lastOf = (kind: string) => steps.findLastIndex((one) => one.kind === kind);
  return (
    <section className={styles.story} aria-labelledby={`story-${visitId}`}>
      <h3 id={`story-${visitId}`} className={styles.storyTitle}>
        {copy.title}
      </h3>
      {steps.length === 0 ? (
        <p className={styles.storyNone}>{copy.none}</p>
      ) : (
        <ol className={styles.storySteps}>
          {steps.map((step, at) => (
            <StepLine
              key={`${step.kind}-${String(at)}`}
              visitId={visitId}
              step={step}
              last={lastOf(step.kind) === at}
              sentBack={sentBack.find((one) => one.kind === step.kind)?.reason ?? null}
              mayCall={maySendBack && mayBack.some((kind) => kind === step.kind)}
              onSent={retry}
            />
          ))}
        </ol>
      )}
      {clientId !== null && steps.some((step) => step.kind.endsWith("photos")) && (
        <OpsLink to={clientPath(clientId, "photos")}>{copy.photos}</OpsLink>
      )}
    </section>
  );
}
