// Customer Care · Messages (docs/decisions/0129-the-care-inbox.md): the chats on our WhatsApp number, a view at a
// time, the longest-waiting first, as a list beside the chat open, with our automatic messages and the client in it.
// The list and the chat read themselves again while in view, and a chat new to the list is said as it comes.

import { Button } from "@maneman/ui/Button";
import { Initials } from "@maneman/ui/Initials";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import type { RuleTone } from "@maneman/ui/Table";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { Toast } from "@maneman/ui/Toast";
import { useLiveLoad } from "@maneman/ui/useLoad";
import { indiaDate, minutesBetween, shortDate } from "@maneman/web-kit/dates";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { careApi, type Conversation, type ConversationView } from "./care-api.ts";
import { care as copy } from "../content/care.ts";
import { today } from "../content/today.ts";
import { ChatClient } from "./ChatClient.tsx";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { CareTeam } from "./CareTeam.tsx";
import { QuickRepliesPanel } from "./QuickReplies.tsx";
import { RemediesPanel } from "./Remedies.tsx";
import { Thread, whoOf } from "./Thread.tsx";
import form from "@maneman/ui/forms.module.css";
import styles from "./messages-screen.module.css";
import { SearchInput } from "@maneman/ui/SearchInput";
import { apiNow } from "@maneman/web-kit/clock";

const VIEWS: readonly ConversationView[] = ["open", "mine", "waiting", "closed", "all"];

/** How often the list is read again while it is in view, for new chats and the clients' replies. */
const LIST_EVERY_MS = 20_000;

/** The views, a chip each, in one row that scrolls sideways where it runs past the list's width. */
function ViewChoice({ view, onView }: { view: ConversationView; onView: (view: ConversationView) => void }) {
  return (
    <div className={styles.views} role="radiogroup" aria-label={copy.show}>
      {VIEWS.map((each) => (
        <ToggleButton
          key={each}
          asRadio
          filled
          pressed={view === each}
          onClick={() => {
            onView(each);
          }}
        >
          {copy.views[each]}
        </ToggleButton>
      ))}
    </div>
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

/** Who the chat is with, as the list names them: the client, one of our technicians, or a number we don't know. */
const nameOf = (conversation: Conversation): string =>
  conversation.technician === null
    ? (conversation.person?.name ?? copy.unknown)
    : copy.technicianName(conversation.technician.name);

/** How long the chat has waited on us, "38 min"; one not waiting on us, the day it last moved. */
function endOf(conversation: Conversation, now: string): string {
  if (conversation.waiting_since === null) return shortDate(indiaDate(conversation.last_message_at));
  return today.waited(minutesBetween(conversation.waiting_since, now));
}

/** Past the time our reply was due, in the error's red; waiting on us, in brass; else no rule. */
function ruleOf(conversation: Conversation, now: string): RuleTone | undefined {
  if (conversation.reply_by !== null && conversation.reply_by < now) return "error";
  return conversation.waiting_since === null ? undefined : "attention";
}

/** One chat in the list: who, what they last said, and how long it has waited on us; it opens beside. */
function ConversationRow(props: { conversation: Conversation; open: boolean; onOpen: (id: string) => void }) {
  const { conversation } = props;
  const now = new Date(apiNow()).toISOString();
  const name = nameOf(conversation);
  const rule = ruleOf(conversation, now);
  return (
    <ListRow
      mark={<Initials name={conversation.person === null && conversation.technician === null ? "#" : name} small />}
      title={name}
      meta={conversation.last_line ?? copy.noLine}
      end={endOf(conversation, now)}
      endTone={rule === "error" ? "error" : "muted"}
      rule={rule}
      current={props.open}
      onClick={() => {
        props.onOpen(conversation.id);
      }}
    />
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
function Conversations({ view, search, tools }: { view: ConversationView; search: string; tools: ReactNode }) {
  const load = useCallback(() => careApi.conversations(view, search), [view, search]);
  const { loaded, refresh, retry } = useLiveLoad(load, LIST_EVERY_MS);
  // The chat open beside the list, held by itself: a reply that moves it out of this view, as a sent reply moves it
  // from waiting on us to waiting on the client, leaves it open until Care close it or open another.
  const [opened, setOpened] = useState<Conversation | null>(null);
  const [older, setOlder] = useState<Older | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const pane = useRef<HTMLDivElement>(null);
  const arrived = useNewChats(loaded.state === "loaded" ? loaded.value.conversations : null);
  if (loaded.state !== "loaded")
    return (
      <div className={styles.inbox}>
        <div className={styles.list}>
          {tools}
          {loaded.state === "loading" ? <PanelLoading /> : <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
        </div>
      </div>
    );
  const conversations = shownOf(loaded.value.conversations, older);
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
  const open = conversations.find((each) => each.id === opened?.id) ?? opened;
  return (
    <div className={styles.inbox}>
      <div className={styles.list}>
        {tools}
        {conversations.length === 0 ? (
          <Note>{copy.none}</Note>
        ) : (
          <ListRows label={copy.chats}>
            {conversations.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                open={conversation.id === opened?.id}
                onOpen={(id) => {
                  setOpened(conversations.find((each) => each.id === id) ?? null);
                  pane.current?.scrollIntoView({ block: "nearest" });
                }}
              />
            ))}
          </ListRows>
        )}
        {next !== null && (
          <div className={styles.more}>
            <Note>{copy.latest(conversations.length)}</Note>
            <Button variant="outline" size="small" busy={loadingOlder} onClick={() => void showOlder(next)}>
              {loadingOlder ? copy.loadingMore : copy.more}
            </Button>
          </div>
        )}
      </div>
      {/* The chat names itself; the box only holds it. */}
      <div className={styles.pane} ref={pane}>
        {open === null ? <Note>{copy.choose}</Note> : <Thread key={open.id} conversation={open} onChanged={refresh} />}
      </div>
      {open !== null && <ChatClient key={open.id} conversation={open} onChanged={refresh} />}
      {arrived !== null && <Toast key={arrived}>{arrived}</Toast>}
    </div>
  );
}

/** The inbox in one box: the chats of a view with how to narrow them, the chat open, and the client it is with. */
export function MessagesScreen() {
  const [view, setView] = useState<ConversationView>("open");
  const [search, setSearch] = useState("");
  return (
    <Conversations
      key={`${view}:${search}`}
      view={view}
      search={search}
      tools={
        <div className={styles.tools}>
          <ViewChoice view={view} onView={setView} />
          <Search search={search} onSearch={setSearch} />
        </div>
      }
    />
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
