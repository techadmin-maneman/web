// One chat in the Care inbox (docs/decisions/0129-the-care-inbox.md): what the client wrote, our replies and notes,
// and our automatic messages to them with how far each got, in order.

import { OpsLink } from "../components/Shell.tsx";
import { textLinkLook } from "@maneman/ui/TextLink";
import { Button } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
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
import styles from "../components/forms.module.css";
import own from "./care.module.css";

const thread = copy.thread;

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
      <li className={own.auto}>
        <span className={own.when}>{whenOf(item.at)}</span> {thread.auto(kindName(item.message), seen)}
      </li>
    );
  }
  const from = fromOf(item);
  return (
    <li className={item.kind === "in" ? own.theirs : own.ours}>
      <span className={own.when}>
        {item.kind === "note" ? `${thread.note} · ` : ""}
        {from} · {whenOf(item.at)}
      </span>
      <span className={own.text}>{item.text ?? thread.erased}</span>
      {item.kind === "out" && item.delivery === "failed" && <span className={own.failed}>{thread.notSent}</span>}
    </li>
  );
}

/** Who the chat is with: one of our technicians, or the client, beside their page and their Care person. */
function About({ conversation }: { conversation: Conversation }) {
  const { person, technician } = conversation;
  if (technician !== null) {
    return (
      <p className={styles.note}>
        {thread.technician}{" "}
        <OpsLink className={textLinkLook()} to={technicianPath(technician.id)}>
          {thread.technicianPage}
        </OpsLink>
      </p>
    );
  }
  if (person === null) return null;
  return (
    <>
      <p className={styles.note}>
        <OpsLink className={textLinkLook()} to={clientPath(person.id, "visits")}>
          {thread.page}
        </OpsLink>
      </p>
      <ClientPanel personId={person.id} />
      <CarePerson personId={person.id} email={conversation.care_person} coveredBy={conversation.covered_by} />
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
  const [loaded, retry] = useLoad(load);
  /** The chat as Care's last reply, note or close left it. */
  const [changed, setChanged] = useState<ChatThread | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const mayAct = useAccess().mayCall("POST /api/conversations/{id}/replies");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const { items } = changed ?? loaded.value;
  return (
    <section className={styles.group} aria-label={thread.title(whoOf(conversation))}>
      <h3 className={styles.ruleTitle}>{thread.title(whoOf(conversation))}</h3>
      <About conversation={conversation} />
      {items.length === 0 ? (
        <p className={styles.note}>{thread.empty}</p>
      ) : (
        <ol className={own.items}>
          {items.map((item) => (
            <Item
              key={`${item.kind}-${item.at}-${item.kind === "auto" ? item.message : (item.text ?? "")}`}
              item={item}
            />
          ))}
        </ol>
      )}
      {said !== null && (
        <p className={styles.saved} role="status">
          {said}
        </p>
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
          }}
        />
      )}
      <div className={styles.actions}>
        <Button variant="outline" size="small" className={styles.quiet} onClick={onClose}>
          {thread.close}
        </Button>
      </div>
    </section>
  );
}
