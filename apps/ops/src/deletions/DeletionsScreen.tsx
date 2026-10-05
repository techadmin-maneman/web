// Deletion requests: a client has asked, from their own app, to have their
// account erased, and ops decide it here (docs/decisions/0049-dpdp.md). The
// runbook's "Erasure within the day" is the procedure; this is where it starts.
//
// The design draws no board for it (docs/fidelity-method.md), so it is built as
// board C1's review queue is. Two things are its own, and both are because an
// erasure cannot be undone:
//
//   - Deleting takes two deliberate steps. The second says what is destroyed
//     and what is kept, and is not offered until ops confirm they have checked
//     the request with the client on their own number (the runbook's step 1).
//   - The panel takes focus when it opens, so it is read by ear as well as by
//     eye before anything is sent.
//
// The decision is written to the audit log as `deletion.decide`, under whoever
// Access says is signed in, in the same batch as the erasure (ADRs 0031, 0066).
// The API refuses while the client has a visit booked or a payment held, and
// the refusal's copy says which, with a link to the client's tab that settles it.

import { REASON_MAX_CHARS } from "../../../../src/policy/decision-reasons.ts";
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
import { OpsLink, Shell } from "../components/Shell.tsx";
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
        <Button
          variant="destructive"
          size="small"
          className={styles.delete}
          disabled={sending || !checked}
          onClick={onDelete}
        >
          {sending ? copy.deleting : copy.confirm}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} disabled={sending} onClick={onCancel}>
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
          <Field label={copy.reason.label} hint={copy.reason.hint}>
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
              className={styles.quiet}
              disabled={sending || reason.trim() === ""}
              onClick={() => void decide("reject")}
            >
              {sending ? copy.rejecting : copy.reason.confirm}
            </Button>
            <Button
              variant="outline"
              size="small"
              className={styles.quiet}
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
            className={styles.delete}
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
            className={styles.quiet}
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
        <p className={styles.error} role="alert">
          {errorText(copy.errors, { code: deciding.code })}
          <SettleOn personId={request.person_id} code={deciding.code} />
        </p>
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

function Queue() {
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
      note={copy.note(copy.processDays)}
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
    <Shell section="/deletion-requests" title={deletions.title}>
      <div className={styles.column}>
        <Queue />
      </div>
    </Shell>
  );
}
