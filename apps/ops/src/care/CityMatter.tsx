// Sending a matter from a chat to the client's city (docs/decisions/0135-city-matters.md): what the city team need to
// know, which waits on their Tasks as a City matter until they close it.

import { Toast } from "@maneman/ui/Toast";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { Button } from "@maneman/ui/Button";
import { CancelButton } from "@maneman/ui/CancelButton";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { FormActions } from "@maneman/ui/FormActions";
import form from "@maneman/ui/forms.module.css";
import { Field, TextArea } from "@maneman/ui/Field";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { care } from "../content/care.ts";
import { Refused } from "@maneman/ui/Refusal";
import { careApi } from "./care-api.ts";
import styles from "./care.module.css";

const copy = care.cityMatter;

/** What the city team need to know, in the drawer, sent to the client's city. */
function MatterFields(props: { conversationId: string; onSent: (city: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState("");
  const [busy, once] = useOneAtATime();
  const [failure, setFailure] = useState<Failure | null>(null);
  const send = () =>
    once(async () => {
      setFailure(null);
      const answer = await careApi.raiseCityMatter(props.conversationId, note.trim());
      if (!answer.ok) {
        setFailure({ code: answer.code, fields: answer.fields });
        return;
      }
      props.onSent(answer.body.city);
    });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className={form.fields}>
        <Field label={copy.label} className={form.field} error={boxError(copy.errors, failure, "note")}>
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
      <Refused failed={failure} errors={copy.errors} boxes={["note"]} />
      <FormActions>
        <Button variant="primary" size="small" type="submit" busy={busy} disabled={note.trim() === ""}>
          {copy.send}
        </Button>
        <CancelButton disabled={busy} onClick={props.onCancel} />
      </FormActions>
    </form>
  );
}

export function CityMatter({ conversationId }: { readonly conversationId: string }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  return (
    <div className={styles.action}>
      {sentTo !== null && <Toast>{copy.sent(sentTo)}</Toast>}
      <DrawerButton label={copy.open}>
        {(close) => (
          <MatterFields
            conversationId={conversationId}
            onSent={(city) => {
              setSentTo(city);
              close();
            }}
            onCancel={close}
          />
        )}
      </DrawerButton>
    </div>
  );
}
