// One client's page: who they are, how to reach them, what waits for them on Tasks, then a tab each for visits, pieces,
// payments, referrals, consents, photographs and history. The record is read once for the page, so moving between tabs
// costs no request; an erased client's page keeps only their visits and money (Erase.tsx).

import { TextLink } from "@maneman/ui/TextLink";
import { ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { DescriptionList } from "@maneman/ui/DescriptionList";
import { ICONS } from "@maneman/brand/icons";
import { Tabs, TAB } from "@maneman/ui/Tabs";
import { failedRequestId, useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { useCallback, useEffect, useState } from "react";
import { api, isErased, type ClientInvite, type ClientRecord } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { PageActions, useRecordTitle } from "../components/PageHead.tsx";
import { clients } from "../content.ts";
import { rememberClient } from "../lib/client-search.ts";
import { phoneWords } from "../lib/phone.ts";
import { clientPath, type ClientTab } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import shared from "./clients.module.css";
import styles from "./client-screen.module.css";
import { Consents } from "./Consents.tsx";
import { Erased, ErasedRecord, NoClient } from "./Erase.tsx";
import { History, replacementDueOf } from "./History.tsx";
import { Invite, type InviteNews } from "./Invite.tsx";
import { OpenTasks } from "./OpenTasks.tsx";
import { Payments } from "./Payments.tsx";
import { Photos, usePhotos } from "./Photos.tsx";
import { Pieces } from "./Pieces.tsx";
import { Visits } from "./Visits.tsx";

type Credits = ClientRecord["credits"];
type Address = ClientRecord["address"];

/** The invite the attach form last answered, and what it found, which stand over the record read on opening. */
interface Attached {
  readonly invite: ClientInvite;
  readonly news: InviteNews;
}

// Null when they hold none, which every page says the one way.
const creditsOf = (credits: Credits) =>
  credits === null
    ? clients.credits.none
    : clients.creditLine(credits.visits, credits.earliest_expiry === null ? null : longDate(credits.earliest_expiry));

/** Who invited the client, a way to their page, and the invite's code: "Vikram Sethi (VSAB23)". */
function InvitedBy({ invite }: { invite: ClientInvite }) {
  const code = clients.meta.inviteCode(invite.code);
  if (invite.referrer === null) return `${clients.invite.erased} ${code}`;
  return (
    <>
      <OpsLink to={clientPath(invite.referrer.id, "visits")}>{invite.referrer.name}</OpsLink> {code}
    </>
  );
}

/** The client's name as the page's title, the way to message them at its right, and their standing beneath. */
function Head({ record, credits, invite }: { record: ClientRecord; credits: Credits; invite: ClientInvite | null }) {
  useRecordTitle(record.name);
  const mobile = phoneWords(record.mobile);
  const facts = [
    { term: clients.meta.state, details: clients.states[record.state] },
    { term: clients.meta.credits, details: creditsOf(credits) },
    {
      term: clients.meta.replacement,
      details: <span className={styles.metaBrass}>{replacementDueOf(record.history)}</span>,
    },
    {
      term: clients.meta.mobile,
      details: (
        <TextLink compact href={`tel:${record.mobile}`} aria-label={clients.callLabel(record.name, mobile)}>
          {mobile}
        </TextLink>
      ),
    },
    ...(invite === null ? [] : [{ term: clients.meta.invitedBy, details: <InvitedBy invite={invite} /> }]),
  ];
  return (
    <>
      <PageActions>
        <ButtonLink
          variant="outline"
          size="small"
          href={whatsappChat(record.mobile)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={clients.whatsappLabel(record.name)}
        >
          <Icon d={ICONS.whatsapp} size="sm" className={shared.icon} />
          {clients.whatsapp}
        </ButtonLink>
      </PageActions>
      <DescriptionList items={facts} />
    </>
  );
}

function Tab({
  clientId,
  tab,
  record,
  credits,
  onCredits,
  attached,
  onAttached,
  address,
  onAddress,
  onChanged,
  onErased,
  photos,
}: {
  clientId: string;
  tab: ClientTab;
  record: ClientRecord;
  credits: Credits;
  onCredits: (credits: Credits) => void;
  attached: Attached | null;
  onAttached: (attached: Attached) => void;
  address: Address;
  onAddress: (address: NonNullable<Address>) => void;
  onChanged: () => void;
  onErased: () => void;
  photos: ReturnType<typeof usePhotos>;
}) {
  if (tab === "visits") {
    return <Visits clientId={clientId} record={record} address={address} onAddress={onAddress} onChanged={onChanged} />;
  }
  if (tab === "pieces") return <Pieces clientId={clientId} />;
  if (tab === "payments") {
    return (
      <Payments
        clientId={clientId}
        payments={record.payments}
        links={record.payment_links}
        invoices={record.invoices}
        credits={credits}
        onCredits={onCredits}
      />
    );
  }
  if (tab === "referrals") {
    return (
      <div className={shared.visits}>
        <Invite
          clientId={clientId}
          invite={attached?.invite ?? record.invite}
          news={attached?.news ?? null}
          onInvite={(invite, news) => {
            onAttached({ invite, news });
          }}
        />
      </div>
    );
  }
  if (tab === "consents") return <Consents clientId={clientId} name={record.name} onErased={onErased} />;
  if (tab === "history") return <History clientId={clientId} history={record.history} />;
  return <Photos photos={photos} name={record.name} />;
}

export function ClientScreen({ clientId, tab }: { clientId: string; tab: ClientTab }) {
  const load = useCallback(() => api.client(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);
  const photos = usePhotos(clientId);
  // What the credit form last answered, which stands over the record read when the page opened.
  const [adjusted, setAdjusted] = useState<{ credits: Credits } | null>(null);
  const [attached, setAttached] = useState<Attached | null>(null);
  // An address a client gave on the phone, saved on this page, which stands over the one read on opening.
  const [given, setGiven] = useState<{ address: NonNullable<Address> } | null>(null);
  const [erasedId, setErasedId] = useState<string | null>(null);
  // Offered again on the Clients page, for the rest of the session.
  const opened = loaded.state === "loaded" && !isErased(loaded.value) ? loaded.value.name : null;
  useEffect(() => {
    if (opened !== null) rememberClient({ id: clientId, name: opened });
  }, [clientId, opened]);

  if (erasedId === clientId) {
    return <Erased />;
  }

  return (
    <>
      {whenLoaded(loaded, {
        loading: <Loading />,
        failed:
          loaded.state === "failed" && loaded.notFound ? (
            <NoClient />
          ) : (
            <PanelFailed onRetry={retry} requestId={failedRequestId(loaded)} />
          ),
        loaded: (record) =>
          isErased(record) ? (
            <ErasedRecord record={record} onChanged={retry} />
          ) : (
            <div className={shared.client}>
              <Head
                record={record}
                credits={adjusted === null ? record.credits : adjusted.credits}
                invite={attached?.invite ?? record.invite}
              />
              <OpenTasks clientId={clientId} />
              <Tabs label={record.name}>
                {clients.tabs.map((each) => (
                  <OpsLink
                    key={each.tab}
                    className={TAB}
                    to={clientPath(clientId, each.tab)}
                    current={each.tab === tab}
                  >
                    {each.label}
                  </OpsLink>
                ))}
              </Tabs>
              <div>
                <Tab
                  clientId={clientId}
                  tab={tab}
                  record={record}
                  credits={adjusted === null ? record.credits : adjusted.credits}
                  onCredits={(credits) => {
                    setAdjusted({ credits });
                  }}
                  attached={attached}
                  onAttached={setAttached}
                  address={given?.address ?? record.address}
                  onAddress={(address) => {
                    setGiven({ address });
                  }}
                  onChanged={retry}
                  onErased={() => {
                    setErasedId(clientId);
                  }}
                  photos={photos}
                />
              </div>
            </div>
          ),
      })}
    </>
  );
}
