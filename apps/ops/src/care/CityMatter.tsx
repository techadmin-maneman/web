// Sending a matter from a chat to the client's city (docs/decisions/0135-city-matters.md): what the city team need to
// know, which waits on their Tasks as a City matter until they close it.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { Button } from "@maneman/ui/Button";
import { Field, TextArea } from "@maneman/ui/Field";
import type { Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { care } from "../content/care.ts";
import { Refused } from "../settings/index.ts";
import { careApi } from "./care-api.ts";
import form from "../components/forms.module.css";
import styles from "./care.module.css";

const copy = care.cityMatter;

export function CityMatter({ conversationId }: { readonly conversationId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, once] = useOneAtATime();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const send = () =>
    once(async () => {
      setFailure(null);
      const answer = await careApi.raiseCityMatter(conversationId, note.trim());
      if (!answer.ok) {
        setFailure({ code: answer.code, fields: answer.fields });
        return;
      }
      setSentTo(answer.body.city);
      setOpen(false);
      setNote("");
    });
  return (
    <div className={styles.closing}>
      {sentTo !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {copy.sent(sentTo)}
        </InlineMessage>
      )}
      {open ? (
        <>
          <Field label={copy.label} className={styles.reply}>
            {(control) => (
              <TextArea
                {...control}
                className={styles.box}
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
          className={form.quiet}
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
