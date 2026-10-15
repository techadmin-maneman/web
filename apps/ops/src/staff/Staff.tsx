// Admin · Staff: who may use the console and for what, whether that is enforced yet, and the service tokens let
// in. No board draws it, so it is laid out as the other Settings panels are. The API narrows the list to the places
// its viewer may see, and refuses a change beyond their own.

import { CheckLine } from "../components/CheckPanel.tsx";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Field, TextInput } from "@maneman/ui/Field";
import { errorText } from "@maneman/web-kit/refusal";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Note } from "@maneman/ui/Note";
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
import { FormDrawer } from "../components/FormDrawer.tsx";
import { AddInDrawer } from "../components/AddInDrawer.tsx";

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
    <Panel titleId="staff-enforcement" title={words.title} padded>
      <Note>{on ? words.on : words.off}</Note>
      {setBy !== null && setAt !== null && <Note>{words.setBy(whoWords(setBy), longDate(setAt))}</Note>}
      {!staff.may_run_access && <Note>{words.onlyNational}</Note>}
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

/** A person's grants, and their removal, in a drawer beside the list; or the form for someone new. */
function PersonDrawer(props: {
  editing: string;
  staff: StaffList;
  person: StaffList["people"][number] | null;
  mayRemove: boolean;
  onDone: (staff: StaffList, said: string) => void;
  onClose: () => void;
}) {
  const { person } = props;
  return (
    <FormDrawer title={props.editing === "new" ? copy.add : props.editing} onClose={props.onClose}>
      <StaffForm
        key={props.editing}
        staff={props.staff}
        person={person}
        onSaved={(next) => {
          props.onDone(next, copy.saved);
        }}
        onCancel={props.onClose}
      />
      {props.mayRemove && person !== null && (
        <DeleteAction
          key={person.email}
          name={person.email}
          words={copy.removing}
          send={() => staffApi.deleteStaff(person.email)}
          refusal={(code) => errorText(copy.errors, { code, fields: [] })}
          onDeleted={(next) => {
            props.onDone(next, copy.removed);
          }}
        />
      )}
    </FormDrawer>
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
    <Panel titleId="staff-people" title={copy.title} padded>
      <Table controls>
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
                    narrow
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
            narrow
            onClick={() => {
              open("new");
            }}
          >
            {copy.add}
          </Button>
        </FormActions>
      )}
      {editing !== null && (
        <PersonDrawer
          editing={editing}
          staff={staff}
          person={person}
          mayRemove={mayRemove}
          onDone={(next, words) => {
            onChanged(next);
            setEditing(null);
            setSaid(words);
          }}
          onClose={() => {
            setEditing(null);
          }}
        />
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
      boxes={["client_id", "label"]}
      checking={<CheckLine>{words.adding(label.trim(), clientId.trim())}</CheckLine>}
    >
      <div className={form.fields}>
        <Field label={words.clientId} className={form.field} box="client_id">
          {(control) => (
            <TextInput
              {...control}
              width="area"
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
        <Field label={words.label} className={form.field} box="label">
          {(control) => (
            <TextInput
              {...control}
              width="area"
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
    <Panel
      titleId="staff-tokens"
      title={words.title}
      padded
      actions={
        staff.may_run_access && (
          <AddInDrawer label={words.addTitle}>
            {(close) => (
              <TokenForm
                onChanged={(next) => {
                  onChanged(next);
                  close();
                }}
              />
            )}
          </AddInDrawer>
        )
      }
    >
      {staff.service_tokens.length === 0 ? (
        <Note>{words.none}</Note>
      ) : (
        <ul className={form.rules}>
          {staff.service_tokens.map((token) => (
            <TokenRow key={token.client_id} token={token} removable={staff.may_run_access} onChanged={onChanged} />
          ))}
        </ul>
      )}
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
