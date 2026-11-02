// A client's chat with Care on their own page: the Messages tab's thread, found by their number, and the line naming
// their Care person at the page's right. Both read the inbox, so a person without it sees neither.

import { EmptyState } from "@maneman/ui/EmptyState";
import { PanelFailed, PanelLoading } from "@maneman/ui/States";
import { useLoad } from "@maneman/ui/useLoad";
import { useCallback, type ReactNode } from "react";
import { care as copy } from "../content/care.ts";
import { useAccess } from "../lib/access.ts";
import { careApi, type Conversation } from "./care-api.ts";
import { Thread } from "./Thread.tsx";
import styles from "./care.module.css";

/** The client's latest chat, searched for by the last ten digits of their number; null where they have none. */
function useChat(clientId: string, mobile: string) {
  const load = useCallback(async () => {
    const answer = await careApi.conversations("all", mobile.slice(-10));
    if (!answer.ok) return answer;
    const chat = answer.body.conversations.find((each) => each.person?.id === clientId) ?? null;
    return { ...answer, body: chat };
  }, [clientId, mobile]);
  return useLoad(load);
}

function Chat(props: { clientId: string; mobile: string; none: ReactNode }) {
  const [loaded, retry] = useChat(props.clientId, props.mobile);
  if (loaded.state === "loading") return <PanelLoading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  if (loaded.value === null) return <EmptyState look="next" line={copy.clientChat.none} action={props.none} />;
  return <Thread conversation={loaded.value} onChanged={retry} />;
}

/** The Messages tab: their chat, or a line that there is none and the way to start one. */
export function ClientChat(props: { clientId: string; mobile: string; none: ReactNode }) {
  const mayRead = useAccess().mayCall("GET /api/conversations");
  return mayRead ? <Chat {...props} /> : <EmptyState look="next" line={copy.clientChat.none} action={props.none} />;
}

const carePersonOf = (chat: Conversation | null): string =>
  chat === null ? copy.carePerson.none : (chat.care_name ?? chat.care_person ?? copy.carePerson.none);

function Line({ clientId, mobile }: { clientId: string; mobile: string }) {
  const [loaded] = useChat(clientId, mobile);
  if (loaded.state !== "loaded") return null;
  return (
    <p className={styles.careLine}>
      {copy.carePerson.label} · {carePersonOf(loaded.value)}
    </p>
  );
}

/** "Care person · Priya", beneath the notes at the right of a client's page. */
export function CarePersonLine({ clientId, mobile }: { clientId: string; mobile: string }) {
  const mayRead = useAccess().mayCall("GET /api/conversations");
  return mayRead ? <Line clientId={clientId} mobile={mobile} /> : null;
}
