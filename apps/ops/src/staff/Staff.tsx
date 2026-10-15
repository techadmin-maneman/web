// Admin · Staff: who may use the console and for what, whether that is enforced yet, and the service tokens let
// in. No board draws it, so it is laid out as the other Settings panels are. The API narrows the list to the places
// its viewer may see, and refuses a change beyond their own.

import { CheckLine } from "../components/CheckPanel.tsx";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Field, TextInput } from "@maneman/ui/Field";
import { errorText } from "@maneman/web-kit/refusal";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { type StaffList, type StaffToken } from "../api.ts";
import { settings } from "../content/settings.ts";
import { useAccess, whoami } from "../lib/access.ts";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { whoWords } from "../lib/who.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { grantWords } from "../lib/grants.ts";
import { ActionCheck, SettingForm, sentOf, useSteps } from "../settings/index.ts";
import { StaffForm } from "./StaffForm.tsx";
import form from "../components/forms.module.css";
import styles from "./staff.module.css";
import { FormActions } from "../components/FormActions.tsx";
import { staffApi } from "./staff-api.ts";

const copy = settings.staff;

interface PanelProps {
  readonly staff: StaffList;
  readonly onChanged: (staff: StaffList) => void;
}

function Enforcement({ staff, onChanged }: PanelProps) {
  const words = copy.enforcement;
  const on = staff.enforced.on;
  const { set_by: setBy, set_at: setAt } = staff.enforced;
  return (
    <Panel titleId="staff-enforcement" title={words.title} className={form.panel}>
      <p className={form.note}>{on ? words.on : words.off}</p>
      {setBy !== null && setAt !== null && <p className={form.note}>{words.setBy(whoWords(setBy), longDate(setAt))}</p>}
      {!staff.may_run_access && <p className={form.note}>{words.onlyNational}</p>}
      {staff.may_run_access && (
        <ActionCheck
          key={String(on)}
          label={on ? words.stop : words.start}
          primary={!on}
          question={on ? words.stopTitle : words.startTitle}
          lines={[on ? words.stopLine : words.startLine]}
          send={async () => sentOf(await staffApi.setEnforcement(!on), (next) => ({ next }))}
          onDone={(sent) => {
            onChanged(sent.next);
          }}
          errors={words.errors}
        />
      )}
    </Panel>
  );
}

function People({ staff, onChanged }: PanelProps) {
  /** The e-mail of the person being changed, "new" while one is added, or null. */
  const [editing, setEditing] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const access = useAccess();
  const mayGrant = access.mayCall("POST /api/staff");
  const [me] = useLoad(whoami);
  const person = staff.people.find((each) => each.email === editing) ?? null;
  // Nobody removes themselves: they would be locked out by their own hand.
  const mayRemove =
    person !== null &&
    access.mayCall("POST /api/staff/delete") &&
    me.state === "loaded" &&
    me.value.signed_in_as.toLowerCase() !== person.email;

  const open = (email: string) => {
    setSaid(null);
    setEditing(email);
  };

  return (
    <Panel titleId="staff-people" title={copy.title} className={form.panel}>
      <Table className={form.table}>
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
          {staff.people.map((each) => (
            <tr key={each.email}>
              <th scope="row">{each.email}</th>
              <td>
                {each.grants.length === 0
                  ? copy.noAccess
                  : each.grants.map((grant) => (
                      <span className={styles.grantLine} key={grantWords(grant)}>
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
                    className={form.quiet}
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
        <FormActions>
          <Button
            variant="outline"
            size="small"
            className={form.quiet}
            onClick={() => {
              open("new");
            }}
          >
            {copy.add}
          </Button>
        </FormActions>
      )}
      {editing !== null && (
        <StaffForm
          key={editing}
          staff={staff}
          person={person}
          onSaved={(next) => {
            onChanged(next);
            setEditing(null);
            setSaid(copy.saved);
          }}
          onCancel={() => {
            setEditing(null);
          }}
        />
      )}
      {mayRemove && (
        <div className={form.group}>
          <DeleteAction
            key={person.email}
            name={person.email}
            words={copy.removing}
            send={() => staffApi.deleteStaff(person.email)}
            refusal={(code) => errorText(copy.errors, { code, fields: [] })}
            onDeleted={(next) => {
              onChanged(next);
              setEditing(null);
              setSaid(copy.removed);
            }}
          />
        </div>
      )}
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
    </Panel>
  );
}

interface TokenRowProps {
  readonly token: StaffToken;
  /** Whether the viewer may take it off: only a person with Admin · Manage nationally. */
  readonly removable: boolean;
  readonly onChanged: (staff: StaffList) => void;
}

function TokenRow({ token, removable, onChanged }: TokenRowProps) {
  const words = copy.tokens;
  return (
    <li className={form.rule}>
      <p className={form.period}>{token.label}</p>
      <p className={form.set}>{token.client_id}</p>
      <p className={form.set}>{words.addedBy(whoWords(token.added_by), longDate(token.added_at))}</p>
      {removable && (
        <ActionCheck
          label={words.remove}
          ariaLabel={words.removeLabel(token.label)}
          question={words.removeTitle(token.label)}
          lines={[words.removeLine]}
          send={async () => sentOf(await staffApi.removeServiceToken(token.client_id), (next) => ({ next }))}
          onDone={(sent) => {
            onChanged(sent.next);
          }}
          errors={words.errors}
        />
      )}
    </li>
  );
}

function TokenForm({ onChanged }: { onChanged: (staff: StaffList) => void }) {
  const words = copy.tokens;
  const [clientId, setClientId] = useState("");
  const [label, setLabel] = useState("");
  const ready = clientId.trim() !== "" && label.trim() !== "";
  const steps = useSteps(
    async () =>
      sentOf(await staffApi.addServiceToken({ client_id: clientId.trim(), label: label.trim() }), (next) => ({
        next,
      })),
    (sent) => {
      setClientId("");
      setLabel("");
      steps.edit();
      onChanged(sent.next);
    },
  );
  return (
    <SettingForm
      title={words.addTitle}
      steps={steps}
      ready={ready}
      errors={words.errors}
      onCancel={null}
      checking={<CheckLine>{words.adding(label.trim(), clientId.trim())}</CheckLine>}
    >
      <div className={form.fields}>
        <Field label={words.clientId} className={form.field}>
          {(control) => (
            <TextInput
              {...control}
              className={form.text}
              autoComplete="off"
              maxLength={100}
              value={clientId}
              onChange={(event) => {
                setClientId(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Field>
        <Field label={words.label} className={form.field}>
          {(control) => (
            <TextInput
              {...control}
              className={form.text}
              maxLength={60}
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                steps.edit();
              }}
            />
          )}
        </Field>
      </div>
    </SettingForm>
  );
}

function ServiceTokens({ staff, onChanged }: PanelProps) {
  const words = copy.tokens;
  return (
    <Panel titleId="staff-tokens" title={words.title} className={form.panel}>
      {staff.service_tokens.length === 0 ? (
        <p className={form.note}>{words.none}</p>
      ) : (
        <ul className={form.rules}>
          {staff.service_tokens.map((token) => (
            <TokenRow key={token.client_id} token={token} removable={staff.may_run_access} onChanged={onChanged} />
          ))}
        </ul>
      )}
      {staff.may_run_access ? <TokenForm onChanged={onChanged} /> : <p className={form.note}>{words.onlyNational}</p>}
    </Panel>
  );
}

export function Staff() {
  const [loaded, retry] = useLoad(staffApi.staff);
  /** The page as the last change left it, so it follows a change without reading it again. */
  const [changed, setChanged] = useState<StaffList | null>(null);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const staff = changed ?? loaded.value;

  return (
    <>
      <Enforcement staff={staff} onChanged={setChanged} />
      <People staff={staff} onChanged={setChanged} />
      <ServiceTokens staff={staff} onChanged={setChanged} />
    </>
  );
}
