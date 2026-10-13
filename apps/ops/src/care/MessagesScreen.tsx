// Customer Care · Messages (docs/decisions/0129-the-care-inbox.md): the chats on our WhatsApp number, a view at a
// time, the longest-waiting first to see, and each chat opened beneath its row with our automatic messages in it.

import { RowButton } from "@maneman/ui/Button";
import { Button } from "@maneman/ui/Button";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { classes } from "@maneman/ui/classes";
import { useLiveLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { careApi, type Conversation, type ConversationView } from "./care-api.ts";
import { Shell } from "../components/Shell.tsx";
import { care as copy } from "../content/care.ts";
import { SECTION_NAMES } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { CareTeam } from "./CareTeam.tsx";
import { QuickRepliesPanel } from "./QuickReplies.tsx";
import { RemediesPanel } from "./Remedies.tsx";
import { Thread, whenOf, whoOf } from "./Thread.tsx";
import styles from "../components/forms.module.css";
import own from "./care.module.css";

const VIEWS: readonly ConversationView[] = ["open", "mine", "waiting", "closed", "all"];
const COLUMNS = 7;

/** How often the list is read again while it is in view, for new chats and the clients' replies. */
const LIST_EVERY_MS = 20_000;

const isView = (value: string): value is ConversationView => VIEWS.some((view) => view === value);

function ViewChoice({ view, onView }: { view: ConversationView; onView: (view: ConversationView) => void }) {
  return (
    <Field label={copy.show}>
      {(control) => (
        <Select
          {...control}
          className={styles.choiceBox}
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

/** A chat found by the client's name or number, in the view shown; found when Find is pressed. */
function Search({ search, onSearch }: { search: string; onSearch: (search: string) => void }) {
  const [typed, setTyped] = useState(search);
  return (
    <form
      className={own.search}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(typed.trim());
      }}
    >
      <Field label={copy.search}>
        {(control) => (
          <TextInput
            {...control}
            type="search"
            value={typed}
            maxLength={80}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        )}
      </Field>
      <Button type="submit" variant="outline" size="small">
        {copy.find}
      </Button>
      {search !== "" && (
        <Button
          variant="outline"
          size="small"
          className={styles.quiet}
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

/** The client's Care person, and who covers them while they are off. */
const carePersonOf = ({ care_person: person, covered_by: cover }: Conversation): string => {
  if (person === null) return "";
  return cover === null ? person : copy.coveredBy(person, cover);
};

/** When our reply is due, in red once it has passed. */
function ReplyBy({ at }: { at: string | null }) {
  if (at === null) return null;
  const when = whenOf(at);
  return Date.parse(at) < Date.now() ? <span className={own.overdue}>{copy.overdue(when)}</span> : copy.replyBy(when);
}

function ConversationRows(props: {
  conversation: Conversation;
  open: boolean;
  onOpen: (id: string | null) => void;
  onChanged: () => void;
}) {
  const { conversation } = props;
  const who = whoOf(conversation);
  return (
    <>
      <tr>
        <th scope="row" className={own.who}>
          {conversation.technician === null
            ? (conversation.person?.name ?? copy.unknown)
            : copy.technicianName(conversation.technician.name)}
        </th>
        <td className={own.number}>{conversation.mobile}</td>
        <td>{carePersonOf(conversation)}</td>
        <td className={own.line}>{conversation.last_line ?? copy.noLine}</td>
        <td className={own.figure}>
          <ReplyBy at={conversation.reply_by} />
        </td>
        <td className={own.figure}>{shortDate(indiaDate(conversation.last_message_at))}</td>
        <td className={own.actions}>
          <RowButton
            className={styles.inline}
            aria-label={copy.openLabel(who)}
            aria-expanded={props.open}
            onClick={() => {
              props.onOpen(props.open ? null : conversation.id);
            }}
          >
            {copy.open}
          </RowButton>
        </td>
      </tr>
      {props.open && (
        <tr className={own.acting}>
          <td colSpan={COLUMNS}>
            <Thread
              conversation={conversation}
              onClose={() => {
                props.onOpen(null);
              }}
              onChanged={props.onChanged}
            />
          </td>
        </tr>
      )}
    </>
  );
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
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const conversations = shownOf(loaded.value.conversations, older);
  if (conversations.length === 0) return <p className={styles.note}>{copy.none}</p>;
  const next = older === null ? loaded.value.next_before : older.next;
  const showOlder = async (before: string) => {
    setLoadingOlder(true);
    const answer = await careApi.conversations(view, search, before);
    setLoadingOlder(false);
    if (!answer.ok) return;
    setOlder({
      conversations: [...(older?.conversations ?? []), ...answer.body.conversations],
      next: answer.body.next_before,
    });
  };
  return (
    <>
      <ConversationTable conversations={conversations} opened={opened} onOpen={setOpened} onChanged={refresh} />
      {next !== null && (
        <div className={own.more}>
          <p className={styles.note}>{copy.latest(conversations.length)}</p>
          <Button variant="outline" size="small" busy={loadingOlder} onClick={() => void showOlder(next)}>
            {loadingOlder ? copy.loadingMore : copy.more}
          </Button>
        </div>
      )}
    </>
  );
}

function ConversationTable(props: {
  conversations: readonly Conversation[];
  opened: string | null;
  onOpen: (id: string | null) => void;
  onChanged: () => void;
}) {
  const columns = copy.columns;
  return (
    <div className={own.scroll}>
      <Table className={classes(styles.table, own.table)}>
        <thead>
          <tr>
            <th scope="col">{columns.client}</th>
            <th scope="col">{columns.number}</th>
            <th scope="col">{columns.carePerson}</th>
            <th scope="col">{columns.said}</th>
            <th scope="col" className={own.figure}>
              {columns.replyBy}
            </th>
            <th scope="col" className={own.figure}>
              {columns.at}
            </th>
            <th scope="col">
              <VisuallyHidden>{columns.open}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.conversations.map((conversation) => (
            <ConversationRows
              key={conversation.id}
              conversation={conversation}
              open={props.opened === conversation.id}
              onOpen={props.onOpen}
              onChanged={props.onChanged}
            />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export function MessagesScreen() {
  const [view, setView] = useState<ConversationView>("open");
  const [search, setSearch] = useState("");
  return (
    <Shell section="/messages" title={SECTION_NAMES.messages}>
      <div className={styles.screen}>
        <Panel titleId="messages" title={copy.title} className={styles.panel}>
          <div className={own.tools}>
            <ViewChoice view={view} onView={setView} />
            <Search search={search} onSearch={setSearch} />
          </div>
          <Conversations key={`${view}:${search}`} view={view} search={search} />
        </Panel>
      </div>
    </Shell>
  );
}

/** Care's own settings, a tab beside the inbox: the team's rota, the remedies Care may offer, and the quick replies. */
export function CareSettingsScreen() {
  return (
    <Shell section="/care-settings" title={SECTION_NAMES["care-settings"]}>
      <div className={styles.screen}>
        <Panel titleId="care-team" title={copy.team.title} className={styles.panel}>
          <CareTeam />
        </Panel>
        <Panel titleId="remedies" title={copy.remedy.panel} className={styles.panel}>
          <RemediesPanel />
        </Panel>
        <Panel titleId="quick-replies" title={copy.quick.panel} className={styles.panel}>
          <QuickRepliesPanel />
        </Panel>
      </div>
    </Shell>
  );
}
