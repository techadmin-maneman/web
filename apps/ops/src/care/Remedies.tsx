// Remedies (docs/decisions/0143-remedies.md): free service visits Care give a client from their chat, with why, and
// the panel on the Messages page where a Customer Care manager approves or declines those above the limit.

import { EmptyState } from "@maneman/ui/EmptyState";
import { Toast } from "@maneman/ui/Toast";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { NoValue } from "@maneman/ui/NoValue";
import { RowHead } from "@maneman/ui/RowHead";
import { ACTIONS, FIGURE, Table } from "@maneman/ui/Table";
import { Narrowing, SortHeads, TableEnd } from "@maneman/ui/TableTools";
import { useTableView, type Column } from "@maneman/ui/useTableView";
import type { Success } from "@maneman/web-kit/api";
import type { paths } from "../api-schema.ts";
import { Badge, type BadgeTone } from "@maneman/ui/Badge";
import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { Button, RowButton } from "@maneman/ui/Button";
import { CancelButton } from "@maneman/ui/CancelButton";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { FormActions } from "@maneman/ui/FormActions";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import form from "@maneman/ui/forms.module.css";
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
      <Field label={copy.visits} className={form.field} error={boxError(copy.errors, props.failure, "visits")}>
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
      <Field label={copy.reason} className={form.field} error={boxError(copy.errors, props.failure, "reason")}>
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

/** How many, why and a note for the team, in the drawer: given at once within the limit, else sent to a manager. */
function RemedyFields(props: { personId: string; onGiven: (said: string) => void; onCancel: () => void }) {
  const [visits, setVisits] = useState(1);
  const [reason, setReason] = useState<RemedyReason>("fit_problem");
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, once] = useOneAtATime();
  const give = () =>
    once(async () => {
      setFailure(null);
      const answer = await careApi.giveRemedy(props.personId, { visits, reason, note: note.trim() });
      if (!answer.ok) {
        setFailure({ code: answer.code, fields: answer.fields });
        return;
      }
      props.onGiven(answer.body.state === "given" ? copy.given(visits) : copy.awaiting);
    });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void give();
      }}
    >
      <div className={form.fields}>
        <Choices visits={visits} reason={reason} onVisits={setVisits} onReason={setReason} failure={failure} />
        <Field label={copy.note} className={form.field} error={boxError(copy.errors, failure, "note")}>
          {(control) => (
            <TextArea
              {...control}
              rows={3}
              maxLength={REASON_MAX_CHARS}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <Refused failed={failure} errors={copy.errors} boxes={["visits", "reason", "note"]} />
      <FormActions>
        <Button variant="primary" size="small" type="submit" busy={busy} disabled={note.trim() === ""}>
          {copy.give}
        </Button>
        <CancelButton disabled={busy} onClick={props.onCancel} />
      </FormActions>
    </form>
  );
}

/** Free visits given from the chat, in a drawer beside it, and what came of the last. */
export function RemedyForm({ personId }: { readonly personId: string }) {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <div className={styles.closing}>
      {said !== null && <Toast>{said}</Toast>}
      <DrawerButton label={copy.open}>
        {(close) => (
          <RemedyFields
            personId={personId}
            onGiven={(words) => {
              setSaid(words);
              close();
            }}
            onCancel={close}
          />
        )}
      </DrawerButton>
    </div>
  );
}

/** Given is done; awaiting a manager is to act on; declined is quiet. */
const STATE_TONES = { given: "done", awaiting: "attention", declined: "neutral" } as const satisfies Readonly<
  Record<string, BadgeTone>
>;

type Remedy = Success<paths["/api/remedies"]["get"]>["remedies"][number];

const [client, visits, why, given, status, note] = copy.columns;

/** Each column sorts; why and where it stands narrow the list. */
const COLUMNS: readonly Column<Remedy>[] = [
  { label: client, sort: (remedy) => remedy.person.name },
  { label: visits, sort: (remedy) => remedy.visits, figure: true },
  { label: why, sort: (remedy) => copy.reasons[remedy.reason], choice: (remedy) => copy.reasons[remedy.reason] },
  { label: given, sort: (remedy) => remedy.given_at },
  { label: status, sort: (remedy) => copy.states[remedy.state], choice: (remedy) => copy.states[remedy.state] },
  { label: note, sort: (remedy) => remedy.note ?? "" },
];

function RemediesTable(props: { remedies: readonly Remedy[]; mayDecide: boolean; retry: () => void }) {
  const { mayDecide, retry } = props;
  const view = useTableView(props.remedies, COLUMNS, { search: (remedy) => remedy.person.name });
  return (
    <>
      <Narrowing view={view} label={copy.find} />
      <Table>
        <thead>
          <tr>
            <SortHeads view={view} />
            <th scope="col">
              <VisuallyHidden>{copy.decide}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {view.shown.map((remedy) => (
            <tr key={remedy.id}>
              <RowHead>{remedy.person.name}</RowHead>
              <td className={FIGURE}>{remedy.visits}</td>
              <td>{copy.reasons[remedy.reason]}</td>
              <td>{shortDate(indiaDate(remedy.given_at))}</td>
              <td>
                <Badge tone={STATE_TONES[remedy.state]}>{copy.states[remedy.state]}</Badge>
              </td>
              <td>{remedy.note ?? <NoValue />}</td>
              <td className={ACTIONS}>
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
      <TableEnd view={view} />
    </>
  );
}

/** Those awaiting a manager first, then the last 30 days' given and declined, a row each. */
export function RemediesPanel() {
  const load = useCallback(() => careApi.remedies(), []);
  const [loaded, retry] = useLoad(load);
  const mayDecide = useAccess().mayCall("POST /api/remedies/{id}/approve");
  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const { remedies } = loaded.value;
  if (remedies.length === 0) return <EmptyState look="panel" line={copy.none} />;
  return <RemediesTable remedies={remedies} mayDecide={mayDecide} retry={retry} />;
}
