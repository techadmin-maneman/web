// One chat in the Care inbox (docs/decisions/0129-the-care-inbox.md): what the client wrote, our replies and notes,
// and our automatic messages to them with how far each got, in order.

import { Button } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import { api, type Conversation, type ThreadItem } from "../api.ts";
import { care as copy } from "../content/care.ts";
import { clientPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
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

const when = (at: string): string => `${shortDate(indiaDate(at))}, ${indiaClock(at)}`;

function Item({ item }: { item: ThreadItem }) {
  if (item.kind === "auto") {
    const seen = [
      item.state === "queued" ? thread.queued : null,
      item.delivered_at === null ? null : thread.delivered,
      item.read_at === null ? null : thread.read,
    ].filter((each) => each !== null);
    return (
      <li className={own.auto}>
        <span className={own.when}>{when(item.at)}</span> {thread.auto(kindName(item.message), seen)}
      </li>
    );
  }
  const from = item.kind === "in" ? thread.client : item.author;
  return (
    <li className={item.kind === "in" ? own.theirs : own.ours}>
      <span className={own.when}>
        {item.kind === "note" ? `${thread.note} · ` : ""}
        {from} · {when(item.at)}
      </span>
      <span className={own.text}>{item.text ?? thread.erased}</span>
    </li>
  );
}

export function Thread({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const load = useCallback(() => api.conversation(conversation.id), [conversation.id]);
  const [loaded, retry] = useLoad(load);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const { items } = loaded.value;
  return (
    <section className={styles.group} aria-label={thread.title(whoOf(conversation))}>
      <h3 className={styles.ruleTitle}>{thread.title(whoOf(conversation))}</h3>
      {conversation.person !== null && (
        <p className={styles.note}>
          <a className={own.link} href={clientPath(conversation.person.id, "visits")}>
            {thread.page}
          </a>
        </p>
      )}
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
      <div className={styles.actions}>
        <Button variant="outline" size="small" className={styles.quiet} onClick={onClose}>
          {thread.close}
        </Button>
      </div>
    </section>
  );
}
