// Remedies (docs/decisions/0143-remedies.md): free service visits Care give a client from their chat, with why, and
// the panel on the Messages page where a Customer Care manager approves or declines those above the limit.

import { Toast } from "@maneman/ui/Toast";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { Note } from "@maneman/ui/Note";
import { NoValue } from "@maneman/ui/NoValue";
import { RowHead } from "@maneman/ui/RowHead";
import { FIGURE, Table } from "@maneman/ui/Table";
import { Badge, type BadgeTone } from "@maneman/ui/Badge";
import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { Button, RowButton } from "@maneman/ui/Button";
import { Field, Select, TextArea } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { shortDate, indiaDate } from "@maneman/web-kit/dates";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import { care } from "../content/care.ts";
import { useAccess } from "../lib/access.ts";
import { Refused } from "@maneman/ui/Refusal";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
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

/** Given is done; awaiting a manager is to act on; declined is quiet. */
const STATE_TONES = { given: "done", awaiting: "attention", declined: "neutral" } as const satisfies Readonly<
  Record<string, BadgeTone>
>;

/** Those awaiting a manager first, then the last 30 days' given and declined, a row each. */
export function RemediesPanel() {
  const load = useCallback(() => careApi.remedies(), []);
  const [loaded, retry] = useLoad(load);
  const mayDecide = useAccess().mayCall("POST /api/remedies/{id}/approve");
  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const { remedies } = loaded.value;
  if (remedies.length === 0) return <Note>{copy.none}</Note>;
  return (
    <Table>
      <thead>
        <tr>
          {copy.columns.map((column, at) => (
            <th key={column} scope="col" className={at === 1 ? FIGURE : undefined}>
              {column}
            </th>
          ))}
          <th scope="col">
            <VisuallyHidden>{copy.decide}</VisuallyHidden>
          </th>
        </tr>
      </thead>
      <tbody>
        {remedies.map((remedy) => (
          <tr key={remedy.id}>
            <RowHead>{remedy.person.name}</RowHead>
            <td className={FIGURE}>{remedy.visits}</td>
            <td>{copy.reasons[remedy.reason]}</td>
            <td>{shortDate(indiaDate(remedy.given_at))}</td>
            <td>
              <Badge tone={STATE_TONES[remedy.state]}>{copy.states[remedy.state]}</Badge>
            </td>
            <td>{remedy.note ?? <NoValue />}</td>
            <td>
              {mayDecide && remedy.state === "awaiting" && (
                <span className={styles.decide}>
                  <RowButton
                    aria-label={copy.approveLabel(remedy.person.name)}
                    onClick={() => void careApi.decideRemedy(remedy.id, true).then(retry)}
                  >
                    {copy.approve}
                  </RowButton>
                  <RowButton
                    aria-label={copy.declineLabel(remedy.person.name)}
                    onClick={() => void careApi.decideRemedy(remedy.id, false).then(retry)}
                  >
                    {copy.decline}
                  </RowButton>
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
