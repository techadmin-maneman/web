// Saved answers (docs/decisions/0141-quick-replies.md): picked in a chat and filled in with the client's first name and
// next visit, and kept on the Messages page by a Customer Care manager, who adds them and retires them, asked once.

import { Field, Select, TextArea, TextInput } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, shortDate } from "@maneman/web-kit/dates";
import { errorText } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import { api, isErased } from "../api.ts";
import { AddForm } from "../components/AddForm.tsx";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { care } from "../content/care.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { careApi } from "./care-api.ts";
import { DrawerButton } from "../components/DrawerButton.tsx";
import { PageActions } from "../components/PageHead.tsx";
import form from "../components/forms.module.css";
import styles from "./care.module.css";

const copy = care.quick;

/** The client's next visit as an answer says it, "Thu 24 Sep, 12 pm"; empty with none booked. */
async function nextVisitOf(personId: string | null): Promise<string> {
  if (personId === null) return "";
  const answer = await api.client(personId);
  if (!answer.ok || isErased(answer.body)) return "";
  const [next] = answer.body.visits.upcoming;
  return next === undefined ? "" : `${shortDate(next.date)}, ${indiaClock(next.starts_at)}`;
}

/** The answer with the client's first name and next visit in it. */
async function filled(text: string, client: { name: string | null; personId: string | null }): Promise<string> {
  const first = client.name?.split(" ")[0] ?? "";
  const withName = text.replaceAll("{name}", first);
  return withName.includes("{next_visit}")
    ? withName.replaceAll("{next_visit}", await nextVisitOf(client.personId))
    : withName;
}

/** The answers to pick from in a chat; picking one puts it, filled in, in the reply box. */
export function QuickReplyPick(props: {
  readonly name: string | null;
  readonly personId: string | null;
  readonly onPick: (text: string) => void;
}) {
  const load = useCallback(() => careApi.quickReplies(), []);
  const [loaded] = useLoad(load);
  if (loaded.state !== "loaded" || loaded.value.replies.length === 0) return null;
  const { replies } = loaded.value;
  return (
    <Field label={copy.pick}>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value=""
          onChange={(event) => {
            const reply = replies.find((each) => each.id === event.target.value);
            if (reply !== undefined) void filled(reply.text, props).then(props.onPick);
          }}
        >
          <option value="">{copy.choose}</option>
          {replies.map((reply) => (
            <option key={reply.id} value={reply.id}>
              {reply.title}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function AddReply({ onAdded, onCancel }: { onAdded: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  return (
    <AddForm
      title={copy.addOne}
      words={copy}
      errors={copy.errors}
      boxes={["title", "text"]}
      send={() => careApi.addQuickReply(title.trim(), text.trim())}
      onAdded={onAdded}
      onCancel={onCancel}
    >
      <div className={form.fields}>
        <Field label={copy.title} className={form.field} box="title">
          {(control) => (
            <TextInput
              {...control}
              maxLength={60}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={copy.text} className={styles.reply} box="text">
          {(control) => (
            <TextArea
              {...control}
              className={styles.box}
              rows={3}
              maxLength={1000}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <Note>{copy.holes}</Note>
    </AddForm>
  );
}

/** The list, for a Customer Care manager to add to and retire from. */
export function QuickRepliesPanel() {
  const load = useCallback(() => careApi.quickReplies(), []);
  const [loaded, retry] = useLoad(load);
  const mayKeep = useAccess().mayCall("POST /api/quick-replies");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const { replies } = loaded.value;
  return (
    <div className={styles.quick}>
      {replies.length === 0 ? (
        <Note>{copy.none}</Note>
      ) : (
        <ul className={styles.leave}>
          {replies.map((reply) => (
            <li key={reply.id}>
              <span className={styles.who}>{reply.title}</span> · {reply.text}{" "}
              {mayKeep && (
                <DeleteAction
                  name={reply.title}
                  tone="danger"
                  words={copy.retiring}
                  send={() => careApi.retireQuickReply(reply.id)}
                  refusal={(code) => errorText(copy.errors, { code })}
                  onDeleted={retry}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {mayKeep && (
        <PageActions>
          <DrawerButton primary label={copy.addOne}>
            {(close) => (
              <AddReply
                onAdded={() => {
                  retry();
                  close();
                }}
                onCancel={close}
              />
            )}
          </DrawerButton>
        </PageActions>
      )}
    </div>
  );
}
