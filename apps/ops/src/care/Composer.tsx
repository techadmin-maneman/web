// What Care write in a chat (docs/decisions/0130-replies-from-the-care-inbox.md): a reply sent from our number, a note
// only staff see, or the chat closed with what it was about. Each answers with the chat as it then stands.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { Button } from "@maneman/ui/Button";
import { Field, Select, TextArea } from "@maneman/ui/Field";
import type { Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import type { Answer } from "../api.ts";
import { careApi, type ChatThread, type CloseReason } from "./care-api.ts";
import { care as copy } from "../content/care.ts";
import { Refused } from "../settings/index.ts";
import { QuickReplyPick } from "./QuickReplies.tsx";
import styles from "../components/forms.module.css";
import own from "./care.module.css";

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
function ReplyBox({ text, onText }: { text: string; onText: (text: string) => void }) {
  return (
    <Field label={compose.label} className={own.reply}>
      {(control) => (
        <TextArea
          {...control}
          className={own.box}
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
function ReasonChoice({ reason, onReason }: { reason: CloseReason; onReason: (reason: CloseReason) => void }) {
  return (
    <Field label={compose.reason}>
      {(control) => (
        <Select
          {...control}
          className={styles.choiceBox}
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

export function Composer(props: {
  readonly conversationId: string;
  /** Whose chat it is, for a quick reply's {name} and {next_visit}. */
  readonly client: { readonly name: string | null; readonly personId: string | null };
  readonly onThread: (thread: ChatThread, said: string) => void;
}) {
  const { conversationId } = props;
  const [text, setText] = useState("");
  const [reason, setReason] = useState<CloseReason>("other");
  const [busy, once] = useOneAtATime();
  const [failure, setFailure] = useState<Failure | null>(null);
  const act = (call: () => Promise<Answer<ChatThread>>, said: (thread: ChatThread) => string) =>
    once(async () => {
      setFailure(null);
      const answer = await call();
      if (!answer.ok) {
        setFailure({ code: answer.code, fields: answer.fields });
        return;
      }
      setText("");
      props.onThread(answer.body, said(answer.body));
    });
  const empty = text.trim() === "";
  return (
    <div className={own.compose}>
      <div className={styles.fields}>
        <QuickReplyPick name={props.client.name} personId={props.client.personId} onPick={setText} />
        <ReplyBox text={text} onText={setText} />
      </div>
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="small"
          disabled={busy || empty}
          onClick={() =>
            void act(
              () => careApi.replyChat(conversationId, text.trim()),
              (thread) => (lastFailed(thread) ? compose.failed : compose.sent),
            )
          }
        >
          {busy ? compose.sending : compose.send}
        </Button>
        <Button
          variant="outline"
          size="small"
          className={styles.quiet}
          disabled={busy || empty}
          onClick={() =>
            void act(
              () => careApi.noteChat(conversationId, text.trim()),
              () => compose.noted,
            )
          }
        >
          {compose.note}
        </Button>
      </div>
      <div className={own.closing}>
        <ReasonChoice reason={reason} onReason={setReason} />
        <Button
          variant="outline"
          size="small"
          className={styles.quiet}
          disabled={busy}
          onClick={() =>
            void act(
              () => careApi.closeChat(conversationId, reason),
              () => compose.closed,
            )
          }
        >
          {compose.closeChat}
        </Button>
      </div>
      <Refused failed={failure} errors={copy.errors} />
    </div>
  );
}
