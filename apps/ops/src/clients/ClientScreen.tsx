// One client's page (Ops Console, board B1's frame, with B2 and B3): who they
// are, the ways to reach them and who invited them, what waits on Tasks for
// them, then their visits, pieces, payments, referrals, consents, photographs or
// history. It opens on Visits.
//
// The record is read once for the page. Visits, Payments, Referrals and History
// are drawn from it, so moving between them costs no request. The photographs' opening
// is held here too, so leaving their tab and coming back is the same view and
// not a second entry in the log.

import { ICONS } from "@maneman/brand/icons";
import { Tabs, TAB } from "@maneman/ui/Tabs";
import { failedRequestId, useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { useCallback, useState } from "react";
import { api, type ClientInvite, type ClientRecord } from "../api.ts";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { clients } from "../content.ts";
import { phoneWords } from "../lib/phone.ts";
import { clientPath, type ClientTab } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./clients.module.css";
import { Consents } from "./Consents.tsx";
import { Erased } from "./Erase.tsx";
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

const creditsOf = (credits: Credits) =>
  credits === null
    ? clients.unknown
    : clients.creditLine(credits.visits, credits.earliest_expiry === null ? null : longDate(credits.earliest_expiry));

/** Who invited the client, a way to their page, and the invite's code: "Vikram Sethi (VSAB23)". */
function InvitedBy({ invite }: { invite: ClientInvite }) {
  const code = clients.meta.inviteCode(invite.code);
  if (invite.referrer === null) return `${clients.invite.erased} ${code}`;
  return (
    <>
      <OpsLink className={styles.metaLink} to={clientPath(invite.referrer.id, "visits")}>
        {invite.referrer.name}
      </OpsLink>{" "}
      {code}
    </>
  );
}

function Head({ record, credits, invite }: { record: ClientRecord; credits: Credits; invite: ClientInvite | null }) {
  const mobile = phoneWords(record.mobile);
  const meta = [
    { key: clients.meta.state, value: clients.states[record.state] },
    { key: clients.meta.credits, value: creditsOf(credits) },
  ];
  return (
    <div className={styles.head}>
      <div className={styles.headLine}>
        <h2 className={styles.name}>{record.name}</h2>
        <a
          className={styles.whatsapp}
          href={whatsappChat(record.mobile)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={clients.whatsappLabel(record.name)}
        >
          <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d={ICONS.whatsapp} />
          </svg>
          {clients.whatsapp}
        </a>
      </div>
      <dl className={styles.meta}>
        {meta.map((each) => (
          <div className={styles.metaItem} key={each.key}>
            <dt className={styles.metaKey}>{each.key}</dt>
            <dd className={styles.metaValue}>{each.value}</dd>
          </div>
        ))}
        <div className={styles.metaItem}>
          <dt className={styles.metaKey}>{clients.meta.replacement}</dt>
          <dd className={`${styles.metaValue ?? ""} ${styles.metaBrass ?? ""}`}>{replacementDueOf(record.history)}</dd>
        </div>
        <div className={styles.metaItem}>
          <dt className={styles.metaKey}>{clients.meta.mobile}</dt>
          <dd className={styles.metaValue}>
            <a
              className={styles.metaLink}
              href={`tel:${record.mobile}`}
              aria-label={clients.callLabel(record.name, mobile)}
            >
              {mobile}
            </a>
          </dd>
        </div>
        {invite !== null && (
          <div className={styles.metaItem}>
            <dt className={styles.metaKey}>{clients.meta.invitedBy}</dt>
            <dd className={styles.metaValue}>
              <InvitedBy invite={invite} />
            </dd>
          </div>
        )}
      </dl>
    </div>
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
      <div className={styles.visits}>
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
  if (tab === "history") return <History history={record.history} />;
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

  if (erasedId === clientId) {
    return (
      <Shell section="/clients" title={clients.title} flush>
        <Erased />
      </Shell>
    );
  }

  return (
    <Shell section="/clients" title={clients.title} flush>
      {whenLoaded(loaded, {
        loading: (
          <div className={styles.waiting}>
            <Loading />
          </div>
        ),
        failed: (
          <div className={styles.waiting}>
            <PanelFailed onRetry={retry} requestId={failedRequestId(loaded)} />
          </div>
        ),
        loaded: (record) => (
          <div className={styles.client}>
            <Head
              record={record}
              credits={adjusted?.credits ?? record.credits}
              invite={attached?.invite ?? record.invite}
            />
            <OpenTasks clientId={clientId} />
            <Tabs className={styles.tabs} label={record.name}>
              {clients.tabs.map((each) => (
                <OpsLink key={each.tab} className={TAB} to={clientPath(clientId, each.tab)} current={each.tab === tab}>
                  {each.label}
                </OpsLink>
              ))}
            </Tabs>
            <div className={styles.panel}>
              <Tab
                clientId={clientId}
                tab={tab}
                record={record}
                credits={adjusted?.credits ?? record.credits}
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
    </Shell>
  );
}
