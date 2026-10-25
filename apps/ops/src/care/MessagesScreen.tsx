// Customer Care · Messages (docs/decisions/0129-the-care-inbox.md): the chats on our WhatsApp number, a view at a
// time, the longest-waiting first, as a list beside the chat open, with our automatic messages and the client in it.
// The list and the chat read themselves again while in view, and a chat new to the list is said as it comes.

import { Button } from "@maneman/ui/Button";
import { Field, Select } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Tile } from "@maneman/ui/Tile";
import { Toast } from "@maneman/ui/Toast";
import { useLiveLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useCallback, useEffect, useRef, useState } from "react";
import { careApi, type Conversation, type ConversationView } from "./care-api.ts";
import { care as copy } from "../content/care.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { CareTeam } from "./CareTeam.tsx";
import { QuickRepliesPanel } from "./QuickReplies.tsx";
import { RemediesPanel } from "./Remedies.tsx";
import { Thread, whenOf, whoOf } from "./Thread.tsx";
import form from "../components/forms.module.css";
import shared from "./care.module.css";
import styles from "./messages-screen.module.css";
import { phoneWords } from "../lib/phone.ts";
import { SearchInput } from "@maneman/ui/SearchInput";

const VIEWS: readonly ConversationView[] = ["open", "mine", "waiting", "closed", "all"];

/** How often the list is read again while it is in view, for new chats and the clients' replies. */
const LIST_EVERY_MS = 20_000;

const isView = (value: string): value is ConversationView => VIEWS.some((view) => view === value);

function ViewChoice({ view, onView }: { view: ConversationView; onView: (view: ConversationView) => void }) {
  return (
    <Field label={copy.show}>
      {(control) => (
        <Select
          {...control}
          width="choice"
          value={view}
          onChange={(event) => {
            if (isView(event.target.value)) onView(event.target.value);
          }}
        >
          {VIEWS.map((each) => (
            <option key={each} value={each}>
              {copy.views[each]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** A pause in typing long enough to search, so the list is asked once a word is down. */
const SEARCH_AFTER_MS = 300;

/** A chat found by the client's name or number, in the view shown, as it is typed. */
function Search({ search, onSearch }: { search: string; onSearch: (search: string) => void }) {
  const [typed, setTyped] = useState(search);
  useEffect(() => {
    if (typed.trim() === search) return;
    const wait = setTimeout(() => {
      onSearch(typed.trim());
    }, SEARCH_AFTER_MS);
    return () => {
      clearTimeout(wait);
    };
  }, [typed, search, onSearch]);
  return (
    <form
      className={styles.search}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(typed.trim());
      }}
    >
      <SearchInput label={copy.search} value={typed} maxLength={80} onChange={setTyped} />
      {search !== "" && (
        <Button
          variant="outline"
          size="small"
          narrow
          onClick={() => {
            setTyped("");
            onSearch("");
          }}
        >
          {copy.clear}
        </Button>
      )}
    </form>
  );
}

/** The client's Care person, by the name clients know them by where one is set, and who covers them while off. */
const carePersonOf = ({ care_person: email, care_name: name, covered_by: cover }: Conversation): string => {
  if (email === null) return "";
  const person = name ?? email;
  return cover === null ? person : copy.coveredBy(person, cover);
};

/** When our reply is due, in red once it has passed. */
function ReplyBy({ at }: { at: string | null }) {
  if (at === null) return null;
  const when = whenOf(at);
  return Date.parse(at) < Date.now() ? (
    <span className={styles.overdue}>{copy.overdue(when)}</span>
  ) : (
    copy.replyBy(when)
  );
}

/** One chat in the list: who, what they last said, when our reply is due and the day it last moved; it opens beside. */
function ConversationCard(props: { conversation: Conversation; open: boolean; onOpen: (id: string) => void }) {
  const { conversation } = props;
  const who = whoOf(conversation);
  const detailsId = `chat-${conversation.id}`;
  const carePerson = carePersonOf(conversation);
  return (
    <li>
      <Tile
        className={props.open ? styles.chatOpen : styles.chat}
        aria-label={copy.openLabel(who)}
        aria-describedby={detailsId}
        aria-current={props.open ? "true" : undefined}
        onClick={() => {
          props.onOpen(conversation.id);
        }}
      >
        <span className={styles.chatHead}>
          <span className={styles.chatWho}>
            {conversation.technician === null
              ? (conversation.person?.name ?? copy.unknown)
              : copy.technicianName(conversation.technician.name)}
          </span>
          <span className={styles.chatAt}>{shortDate(indiaDate(conversation.last_message_at))}</span>
        </span>
        <span id={detailsId} className={styles.chatDetails}>
          <span className={styles.chatLine}>{conversation.last_line ?? copy.noLine}</span>
          <span className={styles.chatMeta}>
            {[phoneWords(conversation.mobile), carePerson].filter((part) => part !== "").join(" · ")}
          </span>
          <span className={styles.chatMeta}>
            <ReplyBy at={conversation.reply_by} />
          </span>
        </span>
      </Tile>
    </li>
  );
}

/** Says a chat the list had not shown before has come in, once the list has been read at least once. */
function useNewChats(conversations: readonly Conversation[] | null): string | null {
  const seen = useRef<ReadonlySet<string> | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    if (conversations === null) return;
    const before = seen.current;
    seen.current = new Set(conversations.map((each) => each.id));
    const arrived = before === null ? undefined : conversations.find((each) => !before.has(each.id));
    if (arrived !== undefined) setSaid(copy.newChat(whoOf(arrived)));
  }, [conversations]);
  return said;
}

interface Older {
  readonly conversations: readonly Conversation[];
  readonly next: string | null;
}

/** The pages shown as one list: a chat that moved up since an older page was read is shown once, where it is now. */
function shownOf(latest: readonly Conversation[], older: Older | null): Conversation[] {
  const seen = new Set(latest.map((conversation) => conversation.id));
  return [...latest, ...(older?.conversations ?? []).filter((conversation) => !seen.has(conversation.id))];
}

/** The view's chats, the latest page kept current while it is in view, and older pages added beneath on asking. */
function Conversations({ view, search }: { view: ConversationView; search: string }) {
  const load = useCallback(() => careApi.conversations(view, search), [view, search]);
  const { loaded, refresh, retry } = useLiveLoad(load, LIST_EVERY_MS);
  const [opened, setOpened] = useState<string | null>(null);
  const [older, setOlder] = useState<Older | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const pane = useRef<HTMLElement>(null);
  const arrived = useNewChats(loaded.state === "loaded" ? loaded.value.conversations : null);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const conversations = shownOf(loaded.value.conversations, older);
  if (conversations.length === 0) return <Note>{copy.none}</Note>;
  const next = older === null ? loaded.value.next_cursor : older.next;
  const showOlder = async (cursor: string) => {
    setLoadingOlder(true);
    const answer = await careApi.conversations(view, search, cursor);
    setLoadingOlder(false);
    if (!answer.ok) return;
    setOlder({
      conversations: [...(older?.conversations ?? []), ...answer.body.conversations],
      next: answer.body.next_cursor,
    });
  };
  const open = conversations.find((each) => each.id === opened) ?? null;
  return (
    <div className={styles.inbox}>
      <div className={styles.list}>
        <ul className={styles.chats} aria-label={copy.chats}>
          {conversations.map((conversation) => (
            <ConversationCard
              key={conversation.id}
              conversation={conversation}
              open={conversation.id === opened}
              onOpen={(id) => {
                setOpened(id);
                pane.current?.scrollIntoView({ block: "nearest" });
              }}
            />
          ))}
        </ul>
        {next !== null && (
          <div className={styles.more}>
            <Note>{copy.latest(conversations.length)}</Note>
            <Button variant="outline" size="small" busy={loadingOlder} onClick={() => void showOlder(next)}>
              {loadingOlder ? copy.loadingMore : copy.more}
            </Button>
          </div>
        )}
      </div>
      <section
        className={styles.pane}
        ref={pane}
        aria-label={open === null ? copy.chats : copy.thread.title(whoOf(open))}
      >
        {open === null ? (
          <Note>{copy.choose}</Note>
        ) : (
          <Thread
            key={open.id}
            conversation={open}
            onClose={() => {
              setOpened(null);
            }}
            onChanged={refresh}
          />
        )}
      </section>
      {arrived !== null && <Toast key={arrived}>{arrived}</Toast>}
    </div>
  );
}

export function MessagesScreen() {
  const [view, setView] = useState<ConversationView>("open");
  const [search, setSearch] = useState("");
  return (
    <div className={form.screen}>
      <Panel titleId="messages" title={copy.title}>
        <div className={shared.tools}>
          <ViewChoice view={view} onView={setView} />
          <Search search={search} onSearch={setSearch} />
        </div>
        <Conversations key={`${view}:${search}`} view={view} search={search} />
      </Panel>
    </div>
  );
}

/** Settings › Care › Team: the team's rota. */
export function CareTeamScreen() {
  return (
    <div className={form.screen}>
      <Panel titleId="care-team" title={copy.team.title}>
        <CareTeam />
      </Panel>
    </div>
  );
}

/** Settings › Care › Remedies: what Care may offer. */
export function RemediesScreen() {
  return (
    <div className={form.screen}>
      <Panel titleId="remedies" title={copy.remedy.panel}>
        <RemediesPanel />
      </Panel>
    </div>
  );
}

/** Settings › Care › Quick replies. */
export function QuickRepliesScreen() {
  return (
    <div className={form.screen}>
      <Panel titleId="quick-replies" title={copy.quick.panel}>
        <QuickRepliesPanel />
      </Panel>
    </div>
  );
}
