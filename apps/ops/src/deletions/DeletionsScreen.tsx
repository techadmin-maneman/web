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
// Access says is signed in, and before the erasure runs (ADR 0031).

import { longDate } from "@maneman/web-kit/dates";
import { useEffect, useRef, useState } from "react";
import { api, type DeletionRequest } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { deletions, waiting } from "../content.ts";
import { daysUntil, dueAfter } from "../lib/due.ts";
import { useLoad } from "../lib/useLoad.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./deletions.module.css";

type Choice = "delete" | "reject";

/** Where a request is in its decision: listed, asked about, sending, or refused by the API. */
type Deciding =
  | { readonly step: "listed" }
  | { readonly step: "asking"; readonly choice: Choice }
  | { readonly step: "sending"; readonly choice: Choice }
  | { readonly step: "failed"; readonly code: string };

const copy = deletions.queue;

/** How long is left of the seven days, against the day the client asked. */
function Left({ requestedAt, now }: { requestedAt: string; now: Date }) {
  const days = daysUntil(dueAfter(requestedAt, copy.processDays), now);
  const over = days < 0;
  return (
    <span className={`${styles.left ?? ""} ${over ? (styles.late ?? "") : ""}`}>
      {over ? waiting.over(-days) : days === 0 ? waiting.today : waiting.left(days)}
    </span>
  );
}

function What({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className={styles.what}>
      <h4 className={styles.whatTitle}>{title}</h4>
      <ul className={styles.whatItems}>
        {items.map((item) => (
          <li key={item} className={styles.whatItem}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  const panel = useRef<HTMLDivElement>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div className={styles.confirm} ref={panel} tabIndex={-1} role="group" aria-label={copy.confirmLabel(request.name)}>
      <p className={styles.warning}>{copy.warning}</p>
      <What title={copy.deleted.title} items={copy.deleted.items} />
      <What title={copy.kept.title} items={copy.kept.items} />
      <div className={styles.checkLine}>
        <input
          id={`checked-${request.id}`}
          className={styles.check}
          type="checkbox"
          checked={checked}
          disabled={sending}
          onChange={(event) => {
            setChecked(event.target.checked);
          }}
        />
        <label className={styles.checkLabel} htmlFor={`checked-${request.id}`}>
          {copy.checked}
        </label>
      </div>
      <div className={styles.actions}>
        <button className={styles.delete} type="button" disabled={sending || !checked} onClick={onDelete}>
          {sending ? copy.deleting : copy.confirm}
        </button>
        <button className={styles.quiet} type="button" disabled={sending} onClick={onCancel}>
          {copy.cancel}
        </button>
      </div>
    </div>
  );
}

function Request({ request, now, onDecided }: { request: DeletionRequest; now: Date; onDecided: () => void }) {
  const [deciding, setDeciding] = useState<Deciding>({ step: "listed" });
  const [reason, setReason] = useState("");

  const decide = async (choice: Choice) => {
    setDeciding({ step: "sending", choice });
    // Rejecting keeps the account and needs a reason; deleting sends the field as null.
    const answer = await api.decideDeletion(request.id, choice, choice === "reject" ? reason.trim() : null);
    if (answer.ok) onDecided();
    else setDeciding({ step: "failed", code: answer.code });
  };

  const asking = deciding.step === "asking" || deciding.step === "sending" ? deciding : null;
  const sending = deciding.step === "sending";
  const listed = () => {
    setDeciding({ step: "listed" });
  };

  return (
    <li className={styles.request}>
      <div className={styles.head}>
        <OpsLink className={styles.name} to={`/clients/${request.person_id}`}>
          {request.name}
        </OpsLink>
        <Left requestedAt={request.requested_at} now={now} />
      </div>
      <p className={styles.who}>{copy.requested(request.mobile, longDate(request.requested_at))}</p>
      {asking?.choice === "delete" && (
        <ConfirmDelete request={request} sending={sending} onDelete={() => void decide("delete")} onCancel={listed} />
      )}
      {asking?.choice === "reject" && (
        <div className={styles.reason}>
          <label className={styles.reasonLabel} htmlFor={`reason-${request.id}`}>
            {copy.reason.label}
          </label>
          <textarea
            id={`reason-${request.id}`}
            className={styles.reasonField}
            maxLength={300}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <p className={styles.reasonHint}>{copy.reason.hint}</p>
          <div className={styles.actions}>
            <button
              className={styles.quiet}
              type="button"
              disabled={sending || reason.trim() === ""}
              onClick={() => void decide("reject")}
            >
              {sending ? copy.rejecting : copy.reason.confirm}
            </button>
            <button className={styles.quiet} type="button" disabled={sending} onClick={listed}>
              {copy.reason.cancel}
            </button>
          </div>
        </div>
      )}
      {asking === null && (
        <div className={styles.actions}>
          <button
            className={styles.delete}
            type="button"
            aria-label={copy.deleteLabel(request.name)}
            onClick={() => {
              setDeciding({ step: "asking", choice: "delete" });
            }}
          >
            {copy.delete}
          </button>
          <button
            className={styles.quiet}
            type="button"
            aria-label={copy.rejectLabel(request.name)}
            onClick={() => {
              setDeciding({ step: "asking", choice: "reject" });
            }}
          >
            {copy.reject}
          </button>
        </div>
      )}
      {deciding.step === "failed" && (
        <p className={styles.error} role="alert">
          {copy.errors[deciding.code] ?? copy.errors.unknown}
        </p>
      )}
    </li>
  );
}

function Queue() {
  const [loaded, retry] = useLoad(api.deletionRequests);
  // A decided request leaves the queue at once; the count follows it.
  const [decided, setDecided] = useState<readonly string[]>([]);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  const now = new Date();
  const open = loaded.value.requests.filter((request) => !decided.includes(request.id));
  return (
    <section className={styles.panel} aria-labelledby="deletions">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="deletions">
          {copy.title}
        </h2>
        <span className={styles.count}>{open.length}</span>
      </div>
      {open.length === 0 ? (
        <p className={styles.empty}>{copy.empty}</p>
      ) : (
        <ul className={styles.requests}>
          {open.map((request) => (
            <Request
              key={request.id}
              request={request}
              now={now}
              onDecided={() => {
                setDecided((already) => [...already, request.id]);
              }}
            />
          ))}
        </ul>
      )}
      <p className={styles.note}>{copy.note(copy.processDays)}</p>
    </section>
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
