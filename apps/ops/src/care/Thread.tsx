// One chat in the Care inbox (docs/decisions/0129-the-care-inbox.md): what the client wrote, our replies and notes,
// and our automatic messages to them with how far each got, in order.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { OpsLink } from "../components/Shell.tsx";
import { textLinkLook } from "@maneman/ui/TextLink";
import { Button } from "@maneman/ui/Button";
import { Note } from "@maneman/ui/Note";
import { useLiveLoad } from "@maneman/ui/useLoad";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useCallback, useEffect, useState } from "react";
import { careApi, type ChatThread, type Conversation, type ThreadItem } from "./care-api.ts";
import { care as copy } from "../content/care.ts";
import { useAccess } from "../lib/access.ts";
import { clientPath, technicianPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { CarePerson } from "./CarePerson.tsx";
import { CityMatter } from "./CityMatter.tsx";
import { RemedyForm } from "./Remedies.tsx";
import { ClientPanel } from "./ClientPanel.tsx";
import { Stranger } from "./Stranger.tsx";
import { Composer } from "./Composer.tsx";
import form from "../components/forms.module.css";
import styles from "./thread.module.css";
import { FormActions } from "../components/FormActions.tsx";

const thread = copy.thread;

/** How often an open chat is read again while it is in view, for the client's next message. */
const THREAD_EVERY_MS = 10_000;

/** Who the chat is with: the client's name, or the number we don't know. */
export const whoOf = (conversation: Conversation): string => conversation.person?.name ?? conversation.mobile;

/** "Visit reminder" from "visit_reminder". */
const kindName = (kind: string): string => {
  const words = kind.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** "21 Sep, 11:42 am". */
export const whenOf = (at: string): string => `${shortDate(indiaDate(at))}, ${indiaClock(at)}`;

/** Who said it: the client, our automatic reply, or the member of staff who wrote it. */
function fromOf(item: Extract<ThreadItem, { kind: "in" | "out" | "note" }>): string {
  if (item.kind === "in") return thread.client;
  return item.author === "auto" ? thread.autoReply : item.author;
}

function Item({ item }: { item: ThreadItem }) {
  if (item.kind === "auto") {
    const seen = [
      item.state === "queued" ? thread.queued : null,
      item.delivered_at === null ? null : thread.delivered,
      item.read_at === null ? null : thread.read,
    ].filter((each) => each !== null);
    return (
      <li className={styles.auto}>
        <span className={styles.when}>{whenOf(item.at)}</span> {thread.auto(kindName(item.message), seen)}
      </li>
    );
  }
  const from = fromOf(item);
  return (
    <li className={item.kind === "in" ? styles.theirs : styles.ours}>
      <span className={styles.when}>
        {item.kind === "note" ? `${thread.note} · ` : ""}
        {from} · {whenOf(item.at)}
      </span>
      <span className={styles.text}>{item.text ?? thread.erased}</span>
      {item.kind === "out" && item.delivery === "failed" && <span className={styles.failed}>{thread.notSent}</span>}
    </li>
  );
}

/** Who the chat is with: one of our technicians, or the client, beside their page and their Care person. */
function About({ conversation }: { conversation: Conversation }) {
  const { person, technician } = conversation;
  if (technician !== null) {
    return (
      <Note>
        {thread.technician}{" "}
        <OpsLink className={textLinkLook()} to={technicianPath(technician.id)}>
          {thread.technicianPage}
        </OpsLink>
      </Note>
    );
  }
  if (person === null) return null;
  return (
    <>
      <Note>
        <OpsLink className={textLinkLook()} to={clientPath(person.id, "visits")}>
          {thread.page}
        </OpsLink>
      </Note>
      <ClientPanel personId={person.id} />
      <CarePerson
        personId={person.id}
        email={conversation.care_person}
        name={conversation.care_name}
        coveredBy={conversation.covered_by}
      />
    </>
  );
}

export function Thread({
  conversation,
  onClose,
  onChanged,
}: {
  conversation: Conversation;
  onClose: () => void;
  /** The chat became a client's: the list is read again. */
  onChanged: () => void;
}) {
  const load = useCallback(() => careApi.conversation(conversation.id), [conversation.id]);
  const { loaded, refresh, retry } = useLiveLoad(load, THREAD_EVERY_MS);
  /** The chat as Care's last reply, note or close left it, until the chat is next read. */
  const [changed, setChanged] = useState<ChatThread | null>(null);
  useEffect(() => {
    setChanged(null);
  }, [loaded]);
  const [said, setSaid] = useState<string | null>(null);
  const mayAct = useAccess().mayCall("POST /api/conversations/{id}/replies");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const { items } = changed ?? loaded.value;
  return (
    <section className={form.group} aria-label={thread.title(whoOf(conversation))}>
      <h3 className={form.ruleTitle}>{thread.title(whoOf(conversation))}</h3>
      <About conversation={conversation} />
      {items.length === 0 ? (
        <Note>{thread.empty}</Note>
      ) : (
        <ol className={styles.items}>
          {items.map((item) => (
            <Item
              key={`${item.kind}-${item.at}-${item.kind === "auto" ? item.message : (item.text ?? "")}`}
              item={item}
            />
          ))}
        </ol>
      )}
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
      {mayAct && conversation.person === null && conversation.technician === null && (
        <Stranger conversationId={conversation.id} onDone={onChanged} />
      )}
      {mayAct && conversation.person !== null && <CityMatter conversationId={conversation.id} />}
      {mayAct && conversation.person !== null && <RemedyForm personId={conversation.person.id} />}
      {mayAct && (
        <Composer
          conversationId={conversation.id}
          client={{ name: conversation.person?.name ?? null, personId: conversation.person?.id ?? null }}
          onThread={(next, words) => {
            setChanged(next);
            setSaid(words);
            // Read again at once, so a read begun before the change cannot put the chat back as it was.
            refresh();
          }}
        />
      )}
      <FormActions>
        <Button variant="outline" size="small" narrow onClick={onClose}>
          {thread.close}
        </Button>
      </FormActions>
    </section>
  );
}
