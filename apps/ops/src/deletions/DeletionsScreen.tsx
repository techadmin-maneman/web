// Deletion requests a client made in their app, decided here (docs/decisions/0049-dpdp.md; the runbook's Erasure within
// the day). An erasure cannot be undone, so deleting takes two steps, the second offered only once ops confirm the
// request with the client on their own number. The API refuses while a visit is booked or a payment held, and says
// which.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { useFocusOnMount } from "@maneman/ui/useFocusOnMount";
import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { Checkbox, Field, TextArea } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { useRef, useState } from "react";
import { api, type DeletionRequest } from "../api.ts";
import { DecisionQueue } from "../components/DecisionQueue.tsx";
import { Reach } from "../components/Reach.tsx";
import { OpsLink } from "../components/Shell.tsx";
import { deletions } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Left } from "../lib/Left.tsx";
import { phoneWords } from "../lib/phone.ts";
import { clientPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "../components/erasure.module.css";
import { ErasureLists } from "../components/ErasureLists.tsx";

type Choice = "delete" | "reject";

/** Where a request is in its decision: listed, asked about, sending, or refused by the API. */
type Deciding =
  | { readonly step: "listed" }
  | { readonly step: "asking"; readonly choice: Choice }
  | { readonly step: "sending"; readonly choice: Choice }
  | { readonly step: "failed"; readonly code: string };

const copy = deletions.queue;

/**
 * The second of the two steps: what the erasure destroys, what it leaves, and
 * the check that the request came from the client. It takes focus as it opens,
 * because it stands where the button that opened it stood.
 */
function ConfirmDelete({
  request,
  sending,
  onDelete,
  onCancel,
}: {
  request: DeletionRequest;
  sending: boolean;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const panel = useFocusOnMount<HTMLDivElement>();
  const [checked, setChecked] = useState(false);

  return (
    <div className={styles.confirm} ref={panel} tabIndex={-1} role="group" aria-label={copy.confirmLabel(request.name)}>
      <p className={styles.warning}>{copy.warning}</p>
      <ErasureLists />
      <Checkbox
        className={styles.checkLine}
        label={copy.checked}
        checked={checked}
        disabled={sending}
        onChange={(event) => {
          setChecked(event.target.checked);
        }}
      />
      <div className={styles.actions}>
        <Button variant="destructive" size="small" disabled={sending || !checked} onClick={onDelete}>
          {sending ? copy.deleting : copy.confirm}
        </Button>
        <Button variant="outline" size="small" disabled={sending} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </div>
  );
}

interface RequestProps {
  readonly request: DeletionRequest;
  readonly now: Date;
  /** Whether the person's access lets them delete the account or reject the request. */
  readonly mayDecide: boolean;
  readonly onDecided: (choice: Choice) => void;
}

function Request({ request, now, mayDecide, onDecided }: RequestProps) {
  const [deciding, setDeciding] = useState<Deciding>({ step: "listed" });
  const [reason, setReason] = useState("");
  const openers = { delete: useRef<HTMLButtonElement>(null), reject: useRef<HTMLButtonElement>(null) };

  const decide = async (choice: Choice) => {
    setDeciding({ step: "sending", choice });
    // Rejecting keeps the account and needs a reason; deleting sends the field as null.
    const answer = await api.decideDeletion(request.id, choice, choice === "reject" ? reason.trim() : null);
    if (answer.ok) onDecided(choice);
    else setDeciding({ step: "failed", code: answer.code });
  };

  const asking = deciding.step === "asking" || deciding.step === "sending" ? deciding : null;
  const sending = deciding.step === "sending";
  /** Back to the list, and the keyboard back to the button that asked, rather than to the top of the page. */
  const listed = (from: Choice) => {
    setDeciding({ step: "listed" });
    requestAnimationFrame(() => openers[from].current?.focus());
  };

  return (
    <>
      <div className={styles.head}>
        <OpsLink className={styles.name} to={clientPath(request.person_id, "consents")}>
          {request.name}
        </OpsLink>
        <Left due={request.due} now={now} />
      </div>
      <p className={styles.who}>{copy.requested(phoneWords(request.mobile), longDate(request.requested_at))}</p>
      <Reach name={request.name} mobile={request.mobile} />
      {asking?.choice === "delete" && (
        <ConfirmDelete
          request={request}
          sending={sending}
          onDelete={() => void decide("delete")}
          onCancel={() => {
            listed("delete");
          }}
        />
      )}
      {asking?.choice === "reject" && (
        <div className={styles.reason}>
          <Field label={copy.reason.label}>
            {(control) => (
              <TextArea
                {...control}
                className={styles.reasonField}
                maxLength={REASON_MAX_CHARS}
                // The field stands where the button that asked for it stood, so the keyboard goes to it.
                autoFocus
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
            )}
          </Field>
          <div className={styles.actions}>
            <Button
              variant="outline"
              size="small"
              disabled={sending || reason.trim() === ""}
              onClick={() => void decide("reject")}
            >
              {sending ? copy.rejecting : copy.reason.confirm}
            </Button>
            <Button
              variant="outline"
              size="small"
              disabled={sending}
              onClick={() => {
                listed("reject");
              }}
            >
              {copy.reason.cancel}
            </Button>
          </div>
        </div>
      )}
      {asking === null && mayDecide && (
        <div className={styles.actions}>
          <Button
            variant="destructive"
            size="small"
            ref={openers.delete}
            aria-label={copy.deleteLabel(request.name)}
            onClick={() => {
              setDeciding({ step: "asking", choice: "delete" });
            }}
          >
            {copy.delete}
          </Button>
          <Button
            variant="outline"
            size="small"
            ref={openers.reject}
            aria-label={copy.rejectLabel(request.name)}
            onClick={() => {
              setDeciding({ step: "asking", choice: "reject" });
            }}
          >
            {copy.reject}
          </Button>
        </div>
      )}
      {deciding.step === "failed" && (
        <InlineMessage tone="error" className={styles.error}>
          {errorText(copy.errors, { code: deciding.code })}
          <SettleOn personId={request.person_id} code={deciding.code} />
        </InlineMessage>
      )}
    </>
  );
}

/** The client's tab where what the refusal names is settled: the visit to cancel, or the refund to see through. */
const SETTLED_ON: Readonly<Record<string, "visits" | "payments">> = {
  visit_booked: "visits",
  payment_held: "payments",
};

function SettleOn({ personId, code }: { personId: string; code: string }) {
  const tab = SETTLED_ON[code];
  if (tab === undefined) return null;
  return (
    <>
      {" "}
      <OpsLink className={styles.settleOn} to={clientPath(personId, tab)}>
        {copy.settleOn[tab]}
      </OpsLink>
    </>
  );
}

function DeletionQueue() {
  const [loaded, retry] = useLoad(api.deletionRequests);
  const mayDecide = useAccess().mayCall("POST /api/deletion-requests/{id}/decision");
  const [done, setDone] = useState<string | null>(null);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const now = new Date();
  return (
    <DecisionQueue
      titleId="deletions"
      title={copy.title}
      items={loaded.value.requests}
      rowKind="request"
      empty={copy.empty}
      done={done}
    >
      {(request, decided) => (
        <Request
          request={request}
          now={now}
          mayDecide={mayDecide}
          onDecided={(choice) => {
            setDone(copy.done[choice]);
            decided();
          }}
        />
      )}
    </DecisionQueue>
  );
}

export function DeletionsScreen() {
  return (
    <div className={styles.column}>
      <DeletionQueue />
    </div>
  );
}
