// What Care write in a chat (docs/decisions/0130-replies-from-the-care-inbox.md): a reply sent from our number, a note
// only staff see, or the chat closed with what it was about. Each answers with the chat as it then stands.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { Button } from "@maneman/ui/Button";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { Segmented } from "@maneman/ui/Segmented";
import { Field, Select, TextArea } from "@maneman/ui/Field";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { careApi, type ChatThread, type CloseReason } from "./care-api.ts";
import { care as copy } from "../content/care.ts";
import { Refused } from "@maneman/ui/Refusal";
import { QuickReplyPick } from "./QuickReplies.tsx";
import form from "@maneman/ui/forms.module.css";
import styles from "./care.module.css";
import { FormActions } from "@maneman/ui/FormActions";

const { compose } = copy;

const REASONS: readonly CloseReason[] = [
  "booking",
  "move_or_cancel",
  "fit_problem",
  "aftercare",
  "billing",
  "sign_in",
  "try_on",
  "data_request",
  "other",
];

const isReason = (value: string): value is CloseReason => REASONS.some((reason) => reason === value);

/** Whether the chat's last reply was refused. */
function lastFailed(thread: ChatThread): boolean {
  const last = thread.items.findLast((item) => item.kind === "out");
  return last?.kind === "out" && last.delivery === "failed";
}

/** The reply's box, which a note uses too. */
function ReplyBox(props: { text: string; onText: (text: string) => void; error: string | null }) {
  const { text, onText } = props;
  return (
    <Field label={compose.label} labelHidden className={styles.reply} error={props.error}>
      {(control) => (
        <TextArea
          {...control}
          className={styles.box}
          rows={3}
          maxLength={4096}
          value={text}
          onChange={(event) => {
            onText(event.target.value);
          }}
        />
      )}
    </Field>
  );
}

/** What the chat was about, as it closes. */
function ReasonChoice(props: { reason: CloseReason; onReason: (reason: CloseReason) => void; error: string | null }) {
  const { reason, onReason } = props;
  return (
    <Field label={compose.reason} error={props.error}>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={reason}
          onChange={(event) => {
            if (isReason(event.target.value)) onReason(event.target.value);
          }}
        >
          {REASONS.map((each) => (
            <option key={each} value={each}>
              {copy.reasons[each]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** Whether what is typed goes to the client, or stays in the chat as a note for the team. */
type Mode = "reply" | "note";

const MODES: readonly (readonly [Mode, string])[] = [
  ["reply", compose.label],
  ["note", compose.noteMode],
];

/** What Send says, by what is being written. */
const sendWords: Readonly<Record<Mode, string>> = { reply: compose.send, note: compose.note };

/** What is said once it went: a note added; a reply sent, or that it did not reach the client. */
function saidOf(mode: Mode, thread: ChatThread): string {
  if (mode === "note") return compose.noted;
  return lastFailed(thread) ? compose.failed : compose.sent;
}

/** The foot of a chat: quick replies over one box, what is written in it over reply or note, and Send. */
export function Composer(props: {
  readonly conversationId: string;
  /** Whose chat it is, for a quick reply's {name} and {next_visit}. */
  readonly client: { readonly name: string | null; readonly personId: string | null };
  readonly onThread: (thread: ChatThread, said: string) => void;
}) {
  const { conversationId } = props;
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("reply");
  const [busy, once] = useOneAtATime();
  const [failure, setFailure] = useState<Failure | null>(null);
  const send = () =>
    once(async () => {
      setFailure(null);
      const typed = text.trim();
      const answer =
        mode === "reply"
          ? await careApi.replyChat(conversationId, typed)
          : await careApi.noteChat(conversationId, typed);
      if (!answer.ok) {
        setFailure({ code: answer.code, fields: answer.fields });
        return;
      }
      setText("");
      props.onThread(answer.body, saidOf(mode, answer.body));
    });
  return (
    <div className={styles.compose}>
      <QuickReplyPick name={props.client.name} personId={props.client.personId} onPick={setText} />
      <div className={styles.composeBox} data-note={mode === "note" || undefined}>
        <ReplyBox text={text} onText={setText} error={boxError(copy.errors, failure, "text")} />
        <div className={styles.composeFoot}>
          <Segmented label={compose.label} options={MODES} value={mode} onChange={setMode} />
          <Button variant="primary" size="small" disabled={busy || text.trim() === ""} onClick={() => void send()}>
            {busy ? compose.sending : sendWords[mode]}
          </Button>
        </div>
      </div>
      <Refused failed={failure} errors={copy.errors} boxes={["text"]} />
    </div>
  );
}

/** Close chat, in the chat's head: what it was about, then Close, in a drawer. */
export function CloseChat(props: {
  readonly conversationId: string;
  readonly onThread: (thread: ChatThread, said: string) => void;
}) {
  return <DrawerButton label={compose.closeChat}>{(close) => <CloseForm {...props} onClosed={close} />}</DrawerButton>;
}

function CloseForm(props: {
  readonly conversationId: string;
  readonly onThread: (thread: ChatThread, said: string) => void;
  readonly onClosed: () => void;
}) {
  const [reason, setReason] = useState<CloseReason>("other");
  const [busy, once] = useOneAtATime();
  const [failure, setFailure] = useState<Failure | null>(null);
  const shut = () =>
    once(async () => {
      setFailure(null);
      const answer = await careApi.closeChat(props.conversationId, reason);
      if (!answer.ok) {
        setFailure({ code: answer.code, fields: answer.fields });
        return;
      }
      props.onClosed();
      props.onThread(answer.body, compose.closed);
    });
  return (
    <div className={form.fields}>
      <ReasonChoice reason={reason} onReason={setReason} error={boxError(copy.errors, failure, "reason")} />
      <FormActions>
        <Button variant="primary" size="small" disabled={busy} onClick={() => void shut()}>
          {compose.closeChat}
        </Button>
      </FormActions>
      <Refused failed={failure} errors={copy.errors} boxes={["reason"]} />
    </div>
  );
}
