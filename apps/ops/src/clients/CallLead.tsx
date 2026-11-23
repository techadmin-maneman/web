// A lead taken on a call, from the Clients page (docs/decisions/0288-attribution-and-conversions.md): their name, their
// mobile, and where they came from, which must be picked before it saves, since a call carries nothing else. A number
// we hold is put on that client's record as a call, and their record is offered.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { Button } from "@maneman/ui/Button";
import { CancelButton } from "@maneman/ui/CancelButton";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { Field } from "@maneman/ui/Field";
import { SelectField, TextField } from "@maneman/ui/FieldRows";
import { describedBy, Missing } from "@maneman/ui/Missing";
import { FormActions } from "@maneman/ui/FormActions";
import { MobileInput } from "@maneman/ui/MobileInput";
import { Refused } from "@maneman/ui/Refusal";
import { InlineMessage } from "@maneman/ui/InlineMessage";
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
    <SelectField
      label={copy.channel}
      className={form.field}
      value={props.value}
      choices={[["", copy.choose], ...DECLARED_CHANNELS.map((each) => [each, copy.channels[each]] as const)]}
      onChange={(chosen) => {
        props.onChange(DECLARED_CHANNELS.find((each) => each === chosen) ?? "");
      }}
    />
  );
}

/** What Save lead waits for, the first thing missing; null once it can save. */
function missingOf(name: string, mobile: string, channel: DeclaredChannel | ""): string | null {
  if (name.trim() === "") return copy.missing.name;
  if (mobile.replace(/\D/g, "").length < 10) return copy.missing.mobile;
  return channel === "" ? copy.missing.channel : null;
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
  const missing = missingOf(name, mobile, channel);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className={form.fields}>
        <TextField
          label={copy.name}
          className={form.field}
          error={refused("name")}
          maxLength={80}
          value={name}
          onChange={setName}
        />
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
          disabled={missing !== null}
          aria-describedby={describedBy("call-lead-missing", missing !== null)}
        >
          {busy ? copy.saving : copy.save}
        </Button>
        <CancelButton disabled={busy} onClick={props.onCancel} />
      </FormActions>
      <Missing id="call-lead-missing" what={missing} />
    </form>
  );
}

/** A lead a call just gave: whose, and whether they were a client already. */
export interface CallTaken {
  readonly personId: string;
  readonly known: boolean;
}

/** The Clients page's one action, filled, for those who may take one. */
export function CallLead(props: { onTaken: (taken: CallTaken) => void }) {
  if (!useAccess().mayCall("POST /api/leads/call")) return null;
  return (
    <DrawerButton label={copy.open} primary>
      {(close) => (
        <CallForm
          onTaken={(done) => {
            props.onTaken(done);
            close();
          }}
          onCancel={close}
        />
      )}
    </DrawerButton>
  );
}

/** What the call last took, on the page until the next, with the way to their record. */
export function CallTakenLine(props: { taken: CallTaken; className?: string }) {
  return (
    <InlineMessage tone="saved" className={props.className}>
      {props.taken.known ? copy.known : copy.saved}{" "}
      <OpsLink to={clientPath(props.taken.personId, "referrals")}>{copy.open_client}</OpsLink>
    </InlineMessage>
  );
}
