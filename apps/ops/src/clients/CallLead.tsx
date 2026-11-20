// A lead taken on a call, from the Clients page (docs/decisions/0288-attribution-and-conversions.md): their name, their
// mobile, and where they came from, which must be picked before it saves, since a call carries nothing else. A number
// we hold is put on that client's record as a call, and their record is offered.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { Button } from "@maneman/ui/Button";
import { CancelButton } from "@maneman/ui/CancelButton";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { FormActions } from "@maneman/ui/FormActions";
import { MobileInput } from "@maneman/ui/MobileInput";
import { Refused } from "@maneman/ui/Refusal";
import { Toast } from "@maneman/ui/Toast";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { DECLARED_CHANNELS, type DeclaredChannel } from "@rules/policy/channels.ts";
import { useState } from "react";
import form from "@maneman/ui/forms.module.css";
import { foundUs } from "../content/found-us.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { clientPath } from "../route.ts";
import { useAccess } from "../lib/access.ts";
import { clientsApi } from "./clients-api.ts";

const copy = foundUs.call;

/** Where the caller came from: nothing chosen until ops pick, so a call is never saved under a guess. */
function ChannelPick(props: { value: DeclaredChannel | ""; onChange: (channel: DeclaredChannel | "") => void }) {
  return (
    <Field label={copy.channel} className={form.field}>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={props.value}
          onChange={(event) => {
            props.onChange(DECLARED_CHANNELS.find((each) => each === event.target.value) ?? "");
          }}
        >
          <option value="">{copy.choose}</option>
          {DECLARED_CHANNELS.map((each) => (
            <option key={each} value={each}>
              {copy.channels[each]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function CallForm(props: { onTaken: (taken: { personId: string; known: boolean }) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [channel, setChannel] = useState<DeclaredChannel | "">("");
  const [busy, once] = useOneAtATime();
  const [failure, setFailure] = useState<Failure | null>(null);
  const save = () =>
    once(async () => {
      if (channel === "") return;
      setFailure(null);
      const answer = await clientsApi.leadFromCall({ name: name.trim(), mobile, channel });
      if (answer.ok) props.onTaken({ personId: answer.body.person_id, known: answer.body.known });
      else setFailure({ code: answer.code, fields: answer.fields });
    });
  const refused = (box: string) => boxError(foundUs.errors, failure, box);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className={form.fields}>
        <Field label={copy.name} className={form.field} error={refused("name")}>
          {(control) => (
            <TextInput
              {...control}
              maxLength={80}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={copy.mobile} className={form.field} error={refused("mobile")}>
          {(control) => (
            <MobileInput
              {...control}
              prefix="+91"
              value={mobile}
              onChange={(event) => {
                setMobile(event.target.value);
              }}
            />
          )}
        </Field>
        <ChannelPick value={channel} onChange={setChannel} />
      </div>
      <Refused failed={failure} errors={foundUs.errors} boxes={["name", "mobile"]} />
      <FormActions>
        <Button
          variant="primary"
          size="small"
          type="submit"
          busy={busy}
          disabled={name.trim() === "" || mobile.replace(/\D/g, "").length < 10 || channel === ""}
        >
          {busy ? copy.saving : copy.save}
        </Button>
        <CancelButton disabled={busy} onClick={props.onCancel} />
      </FormActions>
    </form>
  );
}

/** The Clients page's action, for those who may take one, and what it last took. */
export function CallLead() {
  const [taken, setTaken] = useState<{ personId: string; known: boolean } | null>(null);
  if (!useAccess().mayCall("POST /api/leads/call")) return null;
  return (
    <>
      <DrawerButton label={copy.open}>
        {(close) => (
          <CallForm
            onTaken={(done) => {
              setTaken(done);
              close();
            }}
            onCancel={close}
          />
        )}
      </DrawerButton>
      {taken !== null && (
        <Toast>
          {taken.known ? copy.known : copy.saved}{" "}
          <OpsLink to={clientPath(taken.personId, "referrals")}>{copy.open_client}</OpsLink>
        </Toast>
      )}
    </>
  );
}
