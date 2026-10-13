// Sending a matter from a chat to the client's city (docs/decisions/0135-city-matters.md): what the city team need to
// know, which waits on their Tasks as a City matter until they close it.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { Button } from "@maneman/ui/Button";
import { Field, TextArea } from "@maneman/ui/Field";
import type { Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { care } from "../content/care.ts";
import { Refused } from "../settings/index.ts";
import { careApi } from "./care-api.ts";
import styles from "../components/forms.module.css";
import own from "./care.module.css";

const copy = care.cityMatter;

export function CityMatter({ conversationId }: { readonly conversationId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setFailure(null);
    const answer = await careApi.raiseCityMatter(conversationId, note.trim());
    setBusy(false);
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      return;
    }
    setSentTo(answer.body.city);
    setOpen(false);
    setNote("");
  };
  return (
    <div className={own.closing}>
      {sentTo !== null && (
        <InlineMessage tone="saved" className={styles.saved}>
          {copy.sent(sentTo)}
        </InlineMessage>
      )}
      {open ? (
        <>
          <Field label={copy.label} className={own.reply}>
            {(control) => (
              <TextArea
                {...control}
                className={own.box}
                rows={2}
                maxLength={REASON_MAX_CHARS}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </Field>
          <Button variant="outline" size="small" disabled={busy || note.trim() === ""} onClick={() => void send()}>
            {copy.send}
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="small"
          className={styles.quiet}
          onClick={() => {
            setOpen(true);
          }}
        >
          {copy.open}
        </Button>
      )}
      <Refused failed={failure} errors={copy.errors} />
    </div>
  );
}
