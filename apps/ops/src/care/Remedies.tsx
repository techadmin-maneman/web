// Remedies (docs/decisions/0143-remedies.md): free service visits Care give a client from their chat, with why, and
// the panel on the Messages page where a Customer Care manager approves or declines those above the limit.

import { Toast } from "@maneman/ui/Toast";
import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { Button, RowButton } from "@maneman/ui/Button";
import { Field, Select, TextArea } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { shortDate, indiaDate } from "@maneman/web-kit/dates";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import { care } from "../content/care.ts";
import { useAccess } from "../lib/access.ts";
import { Refused } from "../components/Refusal.tsx";
import { Loading, PanelFailed } from "../states/States.tsx";
import { careApi, type RemedyReason } from "./care-api.ts";
import styles from "./care.module.css";

const copy = care.remedy;

const REASONS: readonly RemedyReason[] = ["fit_problem", "technician_late", "visit_missed", "product_fault", "other"];
const VISITS = [1, 2, 3, 4, 5, 6] as const;

const isReason = (value: string): value is RemedyReason => REASONS.some((reason) => reason === value);

function Choices(props: {
  visits: number;
  reason: RemedyReason;
  onVisits: (visits: number) => void;
  onReason: (reason: RemedyReason) => void;
  failure: Failure | null;
}) {
  return (
    <>
      <Field label={copy.visits} error={boxError(copy.errors, props.failure, "visits")}>
        {(control) => (
          <Select
            {...control}
            width="choice"
            value={String(props.visits)}
            onChange={(event) => {
              props.onVisits(Number(event.target.value));
            }}
          >
            {VISITS.map((each) => (
              <option key={each} value={each}>
                {each}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={copy.reason} error={boxError(copy.errors, props.failure, "reason")}>
        {(control) => (
          <Select
            {...control}
            width="choice"
            value={props.reason}
            onChange={(event) => {
              if (isReason(event.target.value)) props.onReason(event.target.value);
            }}
          >
            {REASONS.map((each) => (
              <option key={each} value={each}>
                {copy.reasons[each]}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </>
  );
}

/** Free visits given from the chat: at once within the limit, else sent to a manager. */
export function RemedyForm({ personId }: { readonly personId: string }) {
  const [open, setOpen] = useState(false);
  const [visits, setVisits] = useState(1);
  const [reason, setReason] = useState<RemedyReason>("fit_problem");
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const give = async () => {
    setFailure(null);
    const answer = await careApi.giveRemedy(personId, { visits, reason, note: note.trim() });
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      return;
    }
    setSaid(answer.body.state === "given" ? copy.given(visits) : copy.awaiting);
    setOpen(false);
    setNote("");
  };
  if (!open) {
    return (
      <div className={styles.closing}>
        {said !== null && <Toast>{said}</Toast>}
        <Button
          variant="outline"
          size="small"
          narrow
          onClick={() => {
            setOpen(true);
          }}
        >
          {copy.open}
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.closing}>
      <Choices visits={visits} reason={reason} onVisits={setVisits} onReason={setReason} failure={failure} />
      <Field label={copy.note} className={styles.reply} error={boxError(copy.errors, failure, "note")}>
        {(control) => (
          <TextArea
            {...control}
            className={styles.box}
            rows={2}
            maxLength={REASON_MAX_CHARS}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        )}
      </Field>
      <Button variant="outline" size="small" disabled={note.trim() === ""} onClick={() => void give()}>
        {copy.give}
      </Button>
      <Refused failed={failure} errors={copy.errors} boxes={["visits", "reason", "note"]} />
    </div>
  );
}

/** Those awaiting a manager first, then the last 30 days' given and declined. */
export function RemediesPanel() {
  const load = useCallback(() => careApi.remedies(), []);
  const [loaded, retry] = useLoad(load);
  const mayDecide = useAccess().mayCall("POST /api/remedies/{id}/approve");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const { remedies } = loaded.value;
  if (remedies.length === 0) return <p className={styles.quick}>{copy.none}</p>;
  return (
    <ul className={`${styles.leave} ${styles.quick}`}>
      {remedies.map((remedy) => (
        <li key={remedy.id}>
          <span className={styles.who}>{remedy.person.name}</span> ·{" "}
          {copy.line(remedy.visits, copy.reasons[remedy.reason], shortDate(indiaDate(remedy.given_at)))} ·{" "}
          {copy.states[remedy.state]}
          {remedy.note === null ? "" : ` · ${remedy.note}`}{" "}
          {mayDecide && remedy.state === "awaiting" && (
            <>
              <RowButton
                beside
                aria-label={copy.approveLabel(remedy.person.name)}
                onClick={() => void careApi.decideRemedy(remedy.id, true).then(retry)}
              >
                {copy.approve}
              </RowButton>{" "}
              <RowButton
                beside
                aria-label={copy.declineLabel(remedy.person.name)}
                onClick={() => void careApi.decideRemedy(remedy.id, false).then(retry)}
              >
                {copy.decline}
              </RowButton>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
