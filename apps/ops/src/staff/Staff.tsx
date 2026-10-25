// Admin · Staff: who may use the console and for what, whether that is enforced yet, and the service tokens let
// in. No board draws it, so it is laid out as the other Settings panels are. A person's row opens their record beside
// the list (docs/decisions/0212-editing-in-place.md). The API narrows the list to the places its viewer may see, and
// refuses a change beyond their own.

import { Toast } from "@maneman/ui/Toast";
import { Field, TextInput } from "@maneman/ui/Field";
import { errorText } from "@maneman/web-kit/refusal";
import { Panel } from "@maneman/ui/Panel";
import { Note } from "@maneman/ui/Note";
import { Table } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { type StaffList, type StaffToken } from "../api.ts";
import { settings } from "../content/settings.ts";
import { useAccess, whoami } from "../lib/access.ts";
import { AddForm } from "../components/AddForm.tsx";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { whoWords } from "../lib/who.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { grantWords } from "../lib/grants.ts";
import { AddPerson } from "./StaffForm.tsx";
import { StaffRecord } from "./StaffRecord.tsx";
import form from "../components/forms.module.css";
import styles from "./staff.module.css";
import { staffApi } from "./staff-api.ts";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { DrawerButton } from "../components/DrawerButton.tsx";

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
      {staff.may_run_access && (
        <div className={form.recordFoot}>
          <DeleteAction
            key={String(on)}
            name={copy.title}
            tone={on ? "danger" : "primary"}
            words={on ? words.stopping : words.starting}
            typed={on ? words.typed : undefined}
            send={() => staffApi.setEnforcement(!on)}
            refusal={(code) => errorText(words.errors, { code })}
            onDeleted={onChanged}
          />
        </div>
      )}
    </Panel>
  );
}

/** Each person by their sign-in email, the way their record opens, with their access and whether they are let in. */
function PeopleTable({ staff, onOpen }: { staff: StaffList; onOpen: (email: string) => void }) {
  return (
    <Table>
      <thead>
        <tr>
          <th scope="col">{copy.columns.person}</th>
          <th scope="col">{copy.columns.access}</th>
          <th scope="col">{copy.columns.state}</th>
        </tr>
      </thead>
      <tbody>
        {staff.people.map((each) => (
          <tr key={each.email}>
            <th scope="row">
              <TextButton
                compact
                aria-label={copy.open(each.email)}
                onClick={() => {
                  onOpen(each.email);
                }}
              >
                {each.email}
              </TextButton>
            </th>
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
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function People({ staff, onChanged }: PanelProps) {
  /** The e-mail of the person open, or null. */
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const access = useAccess();
  const mayGrant = access.mayCall("POST /api/staff");
  const [me] = useLoad(whoami);
  const person = staff.people.find((each) => each.email === open) ?? null;
  // Nobody removes themselves: they would be locked out by their own hand.
  const mayRemove =
    person !== null &&
    access.mayCall("POST /api/staff/delete") &&
    me.state === "loaded" &&
    me.value.signed_in_as.toLowerCase() !== person.email;

  return (
    <Panel
      titleId="staff-people"
      title={copy.title}
      padded
      actions={
        mayGrant && (
          <DrawerButton label={copy.add}>
            {(close) => (
              <AddPerson
                staff={staff}
                onAdded={(next) => {
                  onChanged(next);
                  setSaid(copy.saved);
                  close();
                }}
                onCancel={close}
              />
            )}
          </DrawerButton>
        )
      }
    >
      <PeopleTable
        staff={staff}
        onOpen={(email) => {
          setSaid(null);
          setOpen(email);
        }}
      />
      {said !== null && <Toast>{said}</Toast>}
      {person !== null && (
        <FormDrawer
          title={person.email}
          onClose={() => {
            setOpen(null);
          }}
        >
          <StaffRecord
            staff={staff}
            person={person}
            mayChange={mayGrant}
            mayRemove={mayRemove}
            onSaved={onChanged}
            onRemoved={(next) => {
              onChanged(next);
              setOpen(null);
              setSaid(copy.removed);
            }}
          />
        </FormDrawer>
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
        <DeleteAction
          name={token.label}
          words={words.removing}
          send={() => staffApi.removeServiceToken(token.client_id)}
          refusal={(code) => errorText(words.errors, { code })}
          onDeleted={onChanged}
        />
      )}
    </li>
  );
}

function TokenForm({ onAdded, onCancel }: { onAdded: (staff: StaffList) => void; onCancel: () => void }) {
  const words = copy.tokens;
  const [clientId, setClientId] = useState("");
  const [label, setLabel] = useState("");
  return (
    <AddForm
      title={words.addTitle}
      words={copy.form}
      errors={words.errors}
      boxes={["client_id", "label"]}
      send={() => staffApi.addServiceToken({ client_id: clientId.trim(), label: label.trim() })}
      onAdded={onAdded}
      onCancel={onCancel}
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
              }}
            />
          )}
        </Field>
      </div>
    </AddForm>
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
          <DrawerButton label={words.addTitle}>
            {(close) => (
              <TokenForm
                onAdded={(next) => {
                  onChanged(next);
                  close();
                }}
                onCancel={close}
              />
            )}
          </DrawerButton>
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
