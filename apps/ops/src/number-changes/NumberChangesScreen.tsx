// Requests › Number changes: a code went to both numbers, and the change takes effect only once ops approve it
// (docs/decisions/0042-client-profile.md). A row each, as the redesign draws them, approved or declined from the row;
// a decline needs a reason, asked in the drawer the change opens in, a number someone else holds is refused, and each
// change says how long it has left, as Tasks counts it.

import { Field, TextArea } from "@maneman/ui/Field";
import { CancelButton } from "@maneman/ui/CancelButton";
import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { errorText } from "@maneman/web-kit/refusal";
import { Button, RowButton } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate, longDate, shortDate } from "@maneman/web-kit/dates";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@maneman/ui/EmptyState";
import { FormDrawer } from "@maneman/ui/FormDrawer";
import { Panel } from "@maneman/ui/Panel";
import { RowHead } from "@maneman/ui/RowHead";
import { ACTIONS, RowActions, Table, TableScroll } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { Toast } from "@maneman/ui/Toast";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { rowId, useTargetRow } from "@maneman/ui/target";
import { useHeaderSub } from "../frame/PageHead.tsx";
import { useHeadingAfter } from "../lib/heading-after.ts";
import { type NumberChange } from "../api.ts";
import { Reach } from "../clients/index.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { numberChanges } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Left } from "../lib/Left.tsx";
import { phoneWords } from "../lib/phone.ts";
import { clientPath } from "../route.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import styles from "./number-changes.module.css";
import { Refusal } from "@maneman/ui/Refusal";
import { numberChangesApi } from "./number-changes-api.ts";
import { apiNow } from "@maneman/web-kit/clock";

type Choice = "confirm" | "reject";

/** Where a change is in its decision: open, asked for a reason, sending, or refused by the API. */
type Deciding =
  | { readonly step: "open" }
  | { readonly step: "asking" }
  | { readonly step: "sending"; readonly choice: Choice }
  | { readonly step: "failed"; readonly code: string };

const copy = numberChanges.queue;
/** A row's kind in its id, as a task's link names it: "change-…". */
const ROW = "change";

interface ChangeProps {
  readonly change: NumberChange;
  readonly now: Date;
  /** Whether the person's access lets them confirm or reject it. */
  readonly mayDecide: boolean;
  /** Opened from the row's Decline: the reason is asked at once. */
  readonly startAsking: boolean;
  readonly onDecided: (choice: Choice) => void;
}

/** Who is changing number, from which to which, how long it has left, and whether the new one is someone else's. */
function ChangeFacts({ change, now }: { change: ChangeProps["change"]; now: Date }) {
  return (
    <>
      <div className={styles.head}>
        <OpsLink className={styles.name} to={clientPath(change.person_id, "visits")}>
          {change.name}
        </OpsLink>
        <Left due={change.due} now={now} />
      </div>
      <p className={styles.when}>{copy.requested(longDate(change.requested_at))}</p>
      <p className={styles.move}>{copy.move(phoneWords(change.old_mobile), phoneWords(change.new_mobile))}</p>
      {/* Ops confirm the change with the client on the new number. */}
      <Reach name={change.name} mobile={change.new_mobile} />
      <p className={styles.proven}>{copy.proven}</p>
      {change.new_number_held_by !== null && (
        <p className={styles.proven}>{copy.heldBy(change.new_number_held_by.name, change.new_number_held_by.client)}</p>
      )}
    </>
  );
}

function Change({ change, now, mayDecide, startAsking, onDecided }: ChangeProps) {
  const [deciding, setDeciding] = useState<Deciding>({ step: startAsking ? "asking" : "open" });
  const [reason, setReason] = useState("");
  const rejectButton = useRef<HTMLButtonElement>(null);

  const decide = async (choice: Choice) => {
    setDeciding({ step: "sending", choice });
    const answer = await numberChangesApi.decideNumberChange(
      change.id,
      choice,
      choice === "reject" ? reason.trim() : null,
    );
    if (answer.ok) onDecided(choice);
    else setDeciding({ step: "failed", code: answer.code });
  };

  const sending = deciding.step === "sending";
  // Only a rejection is asked about: the reason is what the route will not take without.
  const asking = deciding.step === "asking" || (sending && deciding.choice === "reject");

  return (
    <>
      <ChangeFacts change={change} now={now} />
      {asking && (
        <div className={styles.reason}>
          <Field label={copy.reason.label} look={{ label: styles.reasonLabel }}>
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
              {sending ? copy.deciding : copy.reason.confirm}
            </Button>
            <CancelButton
              disabled={sending}
              onClick={() => {
                setDeciding({ step: "open" });
                // Back to the button that asked, rather than to the top of the page.
                requestAnimationFrame(() => rejectButton.current?.focus());
              }}
            />
          </div>
        </div>
      )}
      {!asking && mayDecide && (
        <div className={styles.decide}>
          <div className={styles.actions}>
            <Button variant="primary" size="small" disabled={sending} onClick={() => void decide("confirm")}>
              {sending ? copy.deciding : copy.confirm}
            </Button>
            <Button
              variant="outline"
              size="small"
              ref={rejectButton}
              disabled={sending}
              onClick={() => {
                setDeciding({ step: "asking" });
              }}
            >
              {copy.reject}
            </Button>
          </div>
        </div>
      )}
      {deciding.step === "failed" && (
        <Refusal className={styles.error} said={errorText(copy.errors, { code: deciding.code })} />
      )}
    </>
  );
}

/** The row's check: both numbers proven by code, or the new one on another record. */
const checkOf = (change: NumberChange) =>
  change.new_number_held_by === null ? copy.checked : copy.heldShort(change.new_number_held_by.name);

interface RowsProps {
  readonly changes: readonly NumberChange[];
  readonly now: Date;
  readonly mayDecide: boolean;
  readonly busy: string | null;
  readonly onOpen: (id: string, asking: boolean) => void;
  readonly onConfirm: (change: NumberChange) => void;
}

/** Approve and Decline at a row's end, for those who may decide. */
function RowDecision({ change, busy, onOpen, onConfirm }: Omit<RowsProps, "changes" | "now" | "mayDecide"> & {
  readonly change: NumberChange;
}) {
  return (
    <td className={ACTIONS}>
      <RowActions>
        <RowButton
          aria-label={copy.confirmLabel(change.name)}
          disabled={busy !== null}
          onClick={() => {
            onConfirm(change);
          }}
        >
          {copy.confirm}
        </RowButton>
        <RowButton
          aria-label={copy.rejectLabel(change.name)}
          disabled={busy !== null}
          onClick={() => {
            onOpen(change.id, true);
          }}
        >
          {copy.reject}
        </RowButton>
      </RowActions>
    </td>
  );
}

/** The changes waiting, a row each: whose, from which number to which, when, its check, and its decision. */
function ChangeRows({ changes, now, mayDecide, busy, onOpen, onConfirm }: RowsProps) {
  return (
    <TableScroll labelledBy="number-changes">
      <Table>
        <thead>
          <tr>
            {copy.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
            {mayDecide && (
              <th scope="col">
                <VisuallyHidden>{copy.actions}</VisuallyHidden>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={change.id} id={rowId(ROW, change.id)} tabIndex={-1}>
              <RowHead>
                <TextButton
                  compact
                  aria-label={copy.openLabel(change.name)}
                  onClick={() => {
                    onOpen(change.id, false);
                  }}
                >
                  {change.name}
                </TextButton>
              </RowHead>
              <td className={styles.number}>{phoneWords(change.old_mobile)}</td>
              <td className={styles.number}>{phoneWords(change.new_mobile)}</td>
              <td>{shortDate(indiaDate(change.requested_at))}</td>
              <td>{checkOf(change)}</td>
              <td>
                <Left due={change.due} now={now} />
              </td>
              {mayDecide && <RowDecision change={change} busy={busy} onOpen={onOpen} onConfirm={onConfirm} />}
            </tr>
          ))}
        </tbody>
      </Table>
    </TableScroll>
  );
}

export function NumberChangesScreen() {
  const [loaded, retry] = useLoad(numberChangesApi.numberChanges);
  const mayDecide = useAccess().mayCall("POST /api/number-changes/{id}/decision");
  const [decided, setDecided] = useState<readonly string[]>([]);
  const [open, setOpen] = useState<{ readonly id: string; readonly asking: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useHeadingAfter(heading);
  const changes = loaded.state === "loaded" ? loaded.value.changes.filter((each) => !decided.includes(each.id)) : [];
  useHeaderSub(changes.length === 0 ? undefined : copy.toDecide(changes.length));
  // A task links to its change's row ("#change-…"), which opens it once the list is read.
  const target = useTargetRow(loaded.state === "loaded");
  useEffect(() => {
    if (loaded.state === "loaded" && target?.startsWith(`${ROW}-`) === true) {
      setOpen({ id: target.slice(ROW.length + 1), asking: false });
    }
  }, [loaded.state, target]);
  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const now = new Date(apiNow());
  const leave = (change: NumberChange, choice: Choice) => {
    setDecided((already) => [...already, change.id]);
    setSaid(choice === "confirm" ? copy.confirmed(change.name) : copy.rejected(change.name));
    focusHeading(change.id);
    setOpen(null);
  };
  const confirm = async (change: NumberChange) => {
    setBusy(change.id);
    setFailure(null);
    const answer = await numberChangesApi.decideNumberChange(change.id, "confirm", null);
    setBusy(null);
    if (answer.ok) leave(change, "confirm");
    else setFailure(errorText(copy.errors, { code: answer.code }));
  };
  const opened = changes.find((each) => each.id === open?.id) ?? null;
  return (
    <Panel titleId="number-changes" title={copy.title} count={changes.length} headingRef={heading}>
      {changes.length === 0 ? (
        <EmptyState look="panel" line={copy.empty} />
      ) : (
        <ChangeRows
          changes={changes}
          now={now}
          mayDecide={mayDecide}
          busy={busy}
          onOpen={(id, asking) => {
            setOpen({ id, asking });
          }}
          onConfirm={(change) => void confirm(change)}
        />
      )}
      {failure !== null && <Refusal className={styles.error} said={failure} />}
      {said !== null && <Toast>{said}</Toast>}
      {opened !== null && (
        <FormDrawer
          title={opened.name}
          onClose={() => {
            setOpen(null);
          }}
        >
          <Change
            change={opened}
            now={now}
            mayDecide={mayDecide}
            startAsking={open?.asking === true}
            onDecided={(choice) => {
              leave(opened, choice);
            }}
          />
        </FormDrawer>
      )}
    </Panel>
  );
}
