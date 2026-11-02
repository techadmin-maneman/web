// One chat in the Care inbox (docs/decisions/0129-the-care-inbox.md): its head with how long it has waited and Close
// chat; what the client wrote, our replies and notes, and our automatic messages with how far each got, a row of them
// folded into one line; and the reply box at its foot. Who it is with is beside it (./ChatClient.tsx).

import { Toast } from "@maneman/ui/Toast";
import { classes } from "@maneman/ui/classes";
import { TextButton } from "@maneman/ui/TextLink";
import { Note } from "@maneman/ui/Note";
import { typeLook } from "@maneman/ui/type";
import { useLiveLoad } from "@maneman/ui/useLoad";
import { apiNow } from "@maneman/web-kit/clock";
import { indiaClock, indiaDate, minutesBetween, shortDate } from "@maneman/web-kit/dates";
import { useCallback, useEffect, useState } from "react";
import { careApi, type ChatThread, type Conversation, type ThreadItem } from "./care-api.ts";
import { care as copy } from "../content/care.ts";
import { today } from "../content/today.ts";
import { useAccess } from "../lib/access.ts";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { CloseChat, Composer } from "./Composer.tsx";
import styles from "./thread.module.css";

const thread = copy.thread;

/** How often an open chat is read again while it is in view, for the client's next message. */
const THREAD_EVERY_MS = 10_000;

/**
 * Who the chat is with, as the list, its head and the column beside it all name them: one of our technicians, the
 * client, or the number we don't know.
 */
export const whoOf = (conversation: Conversation): string =>
  conversation.technician?.name ?? conversation.person?.name ?? conversation.mobile;

/** Beneath what they wrote: their first name, or the number we don't know. */
const themOf = (conversation: Conversation): string => {
  const named = conversation.technician?.name ?? conversation.person?.name;
  return named === undefined ? thread.client : (named.split(" ")[0] ?? named);
};

/** "Visit reminder" from "visit_reminder". */
const kindName = (kind: string): string => {
  const words = kind.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** "21 Sep, 11:42 am". */
const whenOf = (at: string): string => `${shortDate(indiaDate(at))}, ${indiaClock(at)}`;

/** Who said it: the person the chat is with, our automatic reply, or the member of staff who wrote it. */
function fromOf(item: Extract<ThreadItem, { kind: "in" | "out" | "note" }>, them: string): string {
  if (item.kind === "in") return them;
  return item.author === "auto" ? thread.autoReply : item.author;
}

function Item({ item, them }: { item: ThreadItem; them: string }) {
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
  const said = `${fromOf(item, them)} · ${whenOf(item.at)}`;
  if (item.kind === "note")
    return (
      <li className={styles.note}>
        <span className={styles.when}>
          {thread.note} · {said}
        </span>
        <span className={styles.text}>{item.text ?? thread.erased}</span>
      </li>
    );
  return (
    <li className={item.kind === "in" ? styles.theirs : styles.ours}>
      <span className={classes(styles.bubble, styles.text)}>{item.text ?? thread.erased}</span>
      <span className={styles.when}>{said}</span>
      {item.kind === "out" && item.delivery === "failed" && <span className={styles.failed}>{thread.notSent}</span>}
    </li>
  );
}

/** Our automatic messages in a row: one line saying how many, and each of them once asked for. */
function AutoRun({ items, them }: { items: readonly ThreadItem[]; them: string }) {
  const [shown, setShown] = useState(false);
  if (items.length === 1 || shown)
    return (
      <>
        {items.map((item) => (
          <Item key={keyOf(item)} item={item} them={them} />
        ))}
        {items.length > 1 && (
          <li className={styles.autoRun}>
            <TextButton
              compact
              onClick={() => {
                setShown(false);
              }}
            >
              {thread.hideAutos}
            </TextButton>
          </li>
        )}
      </>
    );
  return (
    <li className={styles.autoRun}>
      {thread.autos(items.length)}{" "}
      <TextButton
        compact
        onClick={() => {
          setShown(true);
        }}
      >
        {thread.showAutos}
      </TextButton>
    </li>
  );
}

const keyOf = (item: ThreadItem): string =>
  `${item.kind}-${item.at}-${item.kind === "auto" ? item.message : (item.text ?? "")}`;

/** The chat's items with each row of our automatic messages folded into one line. */
function Items({ items, them }: { items: readonly ThreadItem[]; them: string }) {
  const runs: ThreadItem[][] = [];
  for (const item of items) {
    const last = runs.at(-1);
    if (item.kind === "auto" && last?.[0]?.kind === "auto") last.push(item);
    else runs.push([item]);
  }
  return (
    <ol className={styles.items}>
      {runs.map((run) =>
        run[0]?.kind === "auto" ? (
          <AutoRun key={keyOf(run[0])} items={run} them={them} />
        ) : (
          run.map((item) => <Item key={keyOf(item)} item={item} them={them} />)
        ),
      )}
    </ol>
  );
}

/** Beneath the name: how long the chat has waited on us, and when our reply is due, in red once it has passed. */
function StateLine({ conversation }: { conversation: Conversation }) {
  const now = new Date(apiNow()).toISOString();
  const waiting =
    conversation.waiting_since === null
      ? null
      : thread.waiting(today.waited(minutesBetween(conversation.waiting_since, now)));
  const due = conversation.reply_by;
  const late = due !== null && due < now;
  if (waiting === null && due === null) return null;
  return (
    <p className={styles.state}>
      {waiting}
      {waiting !== null && due !== null && " · "}
      {due !== null && <span className={late ? styles.late : undefined}>{thread.replyBy(whenOf(due))}</span>}
    </p>
  );
}

export function Thread({
  conversation,
  onChanged,
}: {
  conversation: Conversation;
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
  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const { items } = changed ?? loaded.value;
  const who = whoOf(conversation);
  const applied = (next: ChatThread, words: string) => {
    setChanged(next);
    setSaid(words);
    // Read again at once, so a read begun before the change cannot put the chat back as it was.
    refresh();
    onChanged();
  };
  return (
    <section className={styles.chat} aria-label={thread.title(who)}>
      <header className={styles.head}>
        <div className={styles.headWords}>
          <h3 className={typeLook("title-4", styles.name)}>{who}</h3>
          <StateLine conversation={conversation} />
        </div>
        {mayAct && <CloseChat conversationId={conversation.id} onThread={applied} />}
      </header>
      {items.length === 0 ? <Note>{thread.empty}</Note> : <Items items={items} them={themOf(conversation)} />}
      {said !== null && <Toast>{said}</Toast>}
      {mayAct && (
        <Composer
          conversationId={conversation.id}
          client={{ name: conversation.person?.name ?? null, personId: conversation.person?.id ?? null }}
          onThread={applied}
        />
      )}
    </section>
  );
}
