// Customer Care · Messages (docs/decisions/0129-the-care-inbox.md): the chats on our WhatsApp number, a view at a
// time, the longest-waiting first to see, and each chat opened beneath its row with our automatic messages in it.

import { Field, Select } from "@maneman/ui/Field";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { classes } from "@maneman/ui/classes";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { careApi, type Conversation, type ConversationView } from "./care-api.ts";
import { Shell } from "../components/Shell.tsx";
import { care as copy } from "../content/care.ts";
import { SECTION_NAMES } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { CareTeam } from "./CareTeam.tsx";
import { QuickRepliesPanel } from "./QuickReplies.tsx";
import { Thread, whenOf, whoOf } from "./Thread.tsx";
import styles from "../components/forms.module.css";
import own from "./care.module.css";

const VIEWS: readonly ConversationView[] = ["open", "mine", "waiting", "closed", "all"];
const COLUMNS = 7;

const isView = (value: string): value is ConversationView => VIEWS.some((view) => view === value);

function ViewChoice({ view, onView }: { view: ConversationView; onView: (view: ConversationView) => void }) {
  return (
    <div className={own.tools}>
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
    </div>
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
          <button
            className={styles.inline}
            type="button"
            aria-label={copy.openLabel(who)}
            aria-expanded={props.open}
            onClick={() => {
              props.onOpen(props.open ? null : conversation.id);
            }}
          >
            {copy.open}
          </button>
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

function Conversations({ view }: { view: ConversationView }) {
  const load = useCallback(() => careApi.conversations(view), [view]);
  const [loaded, retry] = useLoad(load);
  const [opened, setOpened] = useState<string | null>(null);
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const { conversations } = loaded.value;
  if (conversations.length === 0) return <p className={styles.note}>{copy.none}</p>;
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
          {conversations.map((conversation) => (
            <ConversationRows
              key={conversation.id}
              conversation={conversation}
              open={opened === conversation.id}
              onOpen={setOpened}
              onChanged={retry}
            />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export function MessagesScreen() {
  const [view, setView] = useState<ConversationView>("open");
  return (
    <Shell section="/messages" title={SECTION_NAMES.messages}>
      <div className={styles.screen}>
        <Panel titleId="messages" title={copy.title} className={styles.panel}>
          <ViewChoice view={view} onView={setView} />
          <Conversations key={view} view={view} />
        </Panel>
        <Panel titleId="care-team" title={copy.team.title} className={styles.panel}>
          <CareTeam />
        </Panel>
        <Panel titleId="quick-replies" title={copy.quick.panel} className={styles.panel}>
          <QuickRepliesPanel />
        </Panel>
      </div>
    </Shell>
  );
}
