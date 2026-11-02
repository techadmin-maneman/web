// Who a chat is with, at the inbox's right (docs/decisions/0140-the-client-panel.md): the client, their facts and the
// way to each part of their page, their Care person; and what Care do for them there, free service visits and a matter
// for their city's team. One of our technicians, or a number we don't know, which Care make a client here.

import { Note } from "@maneman/ui/Note";
import { textLinkLook } from "@maneman/ui/TextLink";
import { typeLook } from "@maneman/ui/type";
import { type Conversation } from "./care-api.ts";
import { care as copy } from "../content/care.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { useAccess } from "../lib/access.ts";
import { clientPath, technicianPath } from "../route.ts";
import { CarePerson } from "./CarePerson.tsx";
import { CityMatter } from "./CityMatter.tsx";
import { ClientPanel } from "./ClientPanel.tsx";
import { RemedyForm } from "./Remedies.tsx";
import { Stranger } from "./Stranger.tsx";
import { whoOf } from "./Thread.tsx";
import styles from "./thread.module.css";

const thread = copy.thread;

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

export function ChatClient({ conversation, onChanged }: { conversation: Conversation; onChanged: () => void }) {
  const mayAct = useAccess().mayCall("POST /api/conversations/{id}/replies");
  const { person, technician } = conversation;
  return (
    <aside className={styles.client} aria-label={copy.panel.title}>
      <h3 className={typeLook("title-4", styles.name)}>{whoOf(conversation)}</h3>
      <About conversation={conversation} />
      {mayAct && person === null && technician === null && (
        <Stranger conversationId={conversation.id} onDone={onChanged} />
      )}
      {mayAct && person !== null && <RemedyForm personId={person.id} />}
      {mayAct && person !== null && <CityMatter conversationId={conversation.id} />}
    </aside>
  );
}
