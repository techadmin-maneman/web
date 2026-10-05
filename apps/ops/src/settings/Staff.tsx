// Admin · Staff: who may use the console and for what, whether that is enforced yet, and the service tokens let
// in. No board draws it, so it is laid out as the other Settings panels are. The API narrows the list to the places
// its viewer may see, and refuses a change beyond their own.

import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type StaffBook, type StaffToken } from "../api.ts";
import { settings } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { whoWords } from "../lib/who.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { CheckPanel } from "./CheckPanel.tsx";
import { grantWords } from "./grants.ts";
import { StaffForm } from "./StaffForm.tsx";
import styles from "./settings.module.css";
import staffStyles from "./staff.module.css";

const copy = settings.staff;

type Confirming = "idle" | "checking" | "sending" | Failure;

const isChecking = (step: Confirming): boolean => step === "checking" || step === "sending";

interface PanelProps {
  readonly book: StaffBook;
  readonly onChanged: (book: StaffBook) => void;
}

function Enforcement({ book, onChanged }: PanelProps) {
  const words = copy.enforcement;
  const [step, setStep] = useState<Confirming>("idle");
  const on = book.enforced.on;
  const { set_by: setBy, set_at: setAt } = book.enforced;

  const send = async () => {
    setStep("sending");
    const answer = await api.setEnforcement(!on);
    if (!answer.ok) {
      setStep({ code: answer.code, fields: answer.fields });
      return;
    }
    setStep("idle");
    onChanged(answer.body);
  };

  return (
    <Panel titleId="staff-enforcement" title={words.title} className={styles.panel}>
      <p className={styles.note}>{on ? words.on : words.off}</p>
      {setBy !== null && setAt !== null && (
        <p className={styles.note}>{words.setBy(whoWords(setBy), longDate(setAt))}</p>
      )}
      {!book.may_run_access && <p className={styles.note}>{words.onlyNational}</p>}
      {book.may_run_access && isChecking(step) && (
        <div className={styles.group}>
          <CheckPanel
            title={on ? words.stopTitle : words.startTitle}
            lines={[on ? words.stopLine : words.startLine]}
            send={on ? words.stop : words.start}
            sending={words.sending}
            back={words.back}
            busy={step === "sending"}
            onSend={() => void send()}
            onBack={() => {
              setStep("idle");
            }}
          />
        </div>
      )}
      {book.may_run_access && !isChecking(step) && (
        <div className={styles.actions}>
          <Button
            variant={on ? "outline" : "primary"}
            size="small"
            className={on ? styles.quiet : styles.save}
            onClick={() => {
              setStep("checking");
            }}
          >
            {on ? words.stop : words.start}
          </Button>
        </div>
      )}
      {typeof step === "object" && (
        <p className={styles.error} role="alert">
          {errorText(words.errors, step)}
        </p>
      )}
    </Panel>
  );
}

function People({ book, onChanged }: PanelProps) {
  /** The e-mail of the person being changed, "new" while one is added, or null. */
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const mayGrant = useAccess().mayCall("POST /api/staff");
  const person = book.people.find((each) => each.email === editing) ?? null;

  const open = (email: string) => {
    setSaved(false);
    setEditing(email);
  };

  return (
    <Panel titleId="staff-people" title={copy.title} className={styles.panel}>
      <p className={styles.note}>{copy.note}</p>
      <Table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{copy.columns.person}</th>
            <th scope="col">{copy.columns.access}</th>
            <th scope="col">{copy.columns.state}</th>
            <th scope="col">
              <VisuallyHidden>{copy.change}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {book.people.map((each) => (
            <tr key={each.email}>
              <th scope="row">{each.email}</th>
              <td>
                {each.grants.length === 0
                  ? copy.noAccess
                  : each.grants.map((grant) => (
                      <span className={staffStyles.grantLine} key={grantWords(grant)}>
                        {grantWords(grant)}
                      </span>
                    ))}
              </td>
              <td>{each.active ? copy.active : copy.inactive}</td>
              <td>
                {mayGrant && (
                  <Button
                    variant="outline"
                    size="small"
                    className={styles.quiet}
                    aria-label={copy.changeLabel(each.email)}
                    onClick={() => {
                      open(each.email);
                    }}
                  >
                    {copy.change}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing === null && mayGrant && (
        <div className={styles.actions}>
          <Button
            variant="outline"
            size="small"
            className={styles.quiet}
            onClick={() => {
              open("new");
            }}
          >
            {copy.add}
          </Button>
        </div>
      )}
      {editing !== null && (
        <StaffForm
          key={editing}
          book={book}
          person={person}
          onSaved={(next) => {
            onChanged(next);
            setEditing(null);
            setSaved(true);
          }}
          onCancel={() => {
            setEditing(null);
          }}
        />
      )}
      {saved && (
        <p className={styles.saved} role="status">
          {copy.saved}
        </p>
      )}
    </Panel>
  );
}

interface TokenRowProps {
  readonly token: StaffToken;
  /** Whether the viewer may take it off: only a person with Admin · Manage nationally. */
  readonly removable: boolean;
  readonly onChanged: (book: StaffBook) => void;
}

function TokenRow({ token, removable, onChanged }: TokenRowProps) {
  const words = copy.tokens;
  const [step, setStep] = useState<Confirming>("idle");

  const remove = async () => {
    setStep("sending");
    const answer = await api.removeServiceToken(token.client_id);
    if (!answer.ok) {
      setStep({ code: answer.code, fields: answer.fields });
      return;
    }
    onChanged(answer.body);
  };

  return (
    <li className={styles.rule}>
      <p className={styles.period}>{token.label}</p>
      <p className={styles.set}>{token.client_id}</p>
      <p className={styles.set}>{words.addedBy(token.added_by, longDate(token.added_at))}</p>
      {removable && isChecking(step) && (
        <CheckPanel
          title={words.removeTitle(token.label)}
          lines={[words.removeLine]}
          send={words.remove}
          sending={words.removing}
          back={words.back}
          busy={step === "sending"}
          onSend={() => void remove()}
          onBack={() => {
            setStep("idle");
          }}
        />
      )}
      {removable && !isChecking(step) && (
        <div className={styles.actions}>
          <Button
            variant="outline"
            size="small"
            className={styles.quiet}
            aria-label={words.removeLabel(token.label)}
            onClick={() => {
              setStep("checking");
            }}
          >
            {words.remove}
          </Button>
        </div>
      )}
      {typeof step === "object" && (
        <p className={styles.error} role="alert">
          {errorText(words.errors, step)}
        </p>
      )}
    </li>
  );
}

function TokenForm({ onChanged }: { onChanged: (book: StaffBook) => void }) {
  const words = copy.tokens;
  const [clientId, setClientId] = useState("");
  const [label, setLabel] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const ready = clientId.trim() !== "" && label.trim() !== "";

  const send = async () => {
    setSending(true);
    const answer = await api.addServiceToken({ client_id: clientId.trim(), label: label.trim() });
    setSending(false);
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      return;
    }
    setClientId("");
    setLabel("");
    setFailure(null);
    onChanged(answer.body);
  };

  return (
    <form
      className={styles.group}
      aria-label={words.add}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="token-client-id">
            {words.clientId}
          </label>
          <input
            id="token-client-id"
            className={styles.text}
            type="text"
            autoComplete="off"
            maxLength={100}
            value={clientId}
            onChange={(event) => {
              setClientId(event.target.value);
              setFailure(null);
            }}
          />
          <p className={styles.hint}>{words.clientIdHint}</p>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="token-label">
            {words.label}
          </label>
          <input
            id="token-label"
            className={styles.text}
            type="text"
            maxLength={60}
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
              setFailure(null);
            }}
          />
        </div>
      </div>
      <div className={styles.actions}>
        <Button type="submit" variant="outline" size="small" className={styles.quiet} disabled={!ready || sending}>
          {sending ? words.adding : words.add}
        </Button>
      </div>
      {failure !== null && (
        <p className={styles.error} role="alert">
          {errorText(words.errors, failure)}
        </p>
      )}
    </form>
  );
}

function ServiceTokens({ book, onChanged }: PanelProps) {
  const words = copy.tokens;
  return (
    <Panel titleId="staff-tokens" title={words.title} className={styles.panel}>
      <p className={styles.note}>{words.note}</p>
      {book.service_tokens.length === 0 ? (
        <p className={styles.note}>{words.none}</p>
      ) : (
        <ul className={styles.rules}>
          {book.service_tokens.map((token) => (
            <TokenRow key={token.client_id} token={token} removable={book.may_run_access} onChanged={onChanged} />
          ))}
        </ul>
      )}
      {book.may_run_access ? <TokenForm onChanged={onChanged} /> : <p className={styles.note}>{words.onlyNational}</p>}
    </Panel>
  );
}

export function Staff() {
  const [loaded, retry] = useLoad(api.staff);
  /** The page as the last change left it, so it follows a change without reading it again. */
  const [changed, setChanged] = useState<StaffBook | null>(null);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const book = changed ?? loaded.value;

  return (
    <>
      <Enforcement book={book} onChanged={setChanged} />
      <People book={book} onChanged={setChanged} />
      <ServiceTokens book={book} onChanged={setChanged} />
    </>
  );
}
