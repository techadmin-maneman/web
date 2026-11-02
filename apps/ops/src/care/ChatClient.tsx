// Who a chat is with, at the inbox's right (docs/decisions/0140-the-client-panel.md). The chat's head names them, so
// the column starts at their facts: a client's next and last visit, free service visits, city and Care person, then
// one stack of what Care do for them, the parts of their page, free service visits and a matter for their city's team.
// One of our technicians: their city and their page. A number we don't know: made a client here.

import { buttonLook } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { useState } from "react";
import { api } from "../api.ts";
import { type Conversation } from "./care-api.ts";
import { care as copy } from "../content/care.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { useAccess } from "../lib/access.ts";
import { technicianPath } from "../route.ts";
import { CareMove, careWords, type Named } from "./CarePerson.tsx";
import { CityMatter } from "./CityMatter.tsx";
import { ClientLinks, ClientPanel } from "./ClientPanel.tsx";
import { RemedyForm } from "./Remedies.tsx";
import { Stranger } from "./Stranger.tsx";
import care from "./care.module.css";
import styles from "./thread.module.css";

const thread = copy.thread;

/** One of our technicians: their city, as the roster has it, and their page. */
function TechnicianSide({ id }: { id: string }) {
  const [roster] = useLoad(api.roster);
  const city = roster.state === "loaded" ? roster.value.technicians.find((each) => each.id === id)?.city : undefined;
  return (
    <>
      {city !== undefined && (
        <dl className={care.facts}>
          <dt>{copy.panel.city}</dt>
          <dd>{city ?? copy.panel.noAddress}</dd>
        </dl>
      )}
      <div className={care.panelLinks}>
        <OpsLink className={buttonLook({ variant: "outline", size: "small" })} to={technicianPath(id)}>
          {thread.technicianPage}
        </OpsLink>
      </div>
    </>
  );
}

/** A client: their facts with their Care person among them, then what Care do for them, then moving them on. */
function ClientSide({ conversation, mayAct }: { conversation: Conversation; mayAct: boolean }) {
  const personId = conversation.person?.id ?? "";
  const [carePerson, setCarePerson] = useState<Named | null>(
    conversation.care_person === null ? null : { email: conversation.care_person, name: conversation.care_name },
  );
  return (
    <>
      <ClientPanel
        personId={personId}
        carePerson={careWords(carePerson, conversation.care_person, conversation.covered_by)}
      />
      <div className={care.panelLinks}>
        <ClientLinks personId={personId} />
        {mayAct && <RemedyForm personId={personId} />}
        {mayAct && <CityMatter conversationId={conversation.id} />}
      </div>
      <CareMove personId={personId} now={carePerson} onMoved={setCarePerson} />
    </>
  );
}

export function ChatClient({ conversation, onChanged }: { conversation: Conversation; onChanged: () => void }) {
  const mayAct = useAccess().mayCall("POST /api/conversations/{id}/replies");
  const { person, technician } = conversation;
  return (
    <aside className={styles.client} aria-label={copy.panel.title}>
      {technician !== null && <TechnicianSide id={technician.id} />}
      {technician === null && person !== null && <ClientSide conversation={conversation} mayAct={mayAct} />}
      {mayAct && person === null && technician === null && (
        <Stranger conversationId={conversation.id} onDone={onChanged} />
      )}
    </aside>
  );
}
