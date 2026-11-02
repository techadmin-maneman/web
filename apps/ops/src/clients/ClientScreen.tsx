// One client's page: their initials, name, badges and facts in the head, with Call, WhatsApp and Book a visit; what
// waits for them on Tasks; a tab each from visits to history; and their figures, address, notes and Care person at the
// right (./ClientAside.tsx). The record is read once for the page, so moving between tabs costs no request; an erased
// client's page keeps only their visits and money (Erase.tsx).

import { Button, ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { GLYPHS, ICONS } from "@maneman/brand/icons";
import { PageTitle } from "@maneman/ui/PageHeader";
import { Stack } from "@maneman/ui/Layout";
import { Tabs, TAB } from "@maneman/ui/Tabs";
import { PanelLoading, PanelFailed } from "@maneman/ui/States";
import { failedRequestId, useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { indiaDate, shortMonth, todayInIndia } from "@maneman/web-kit/dates";
import { apiNow } from "@maneman/web-kit/clock";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, isErased, type ClientInvite, type ClientRecord } from "../api.ts";
import { ClientChat } from "../care/index.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { PageActions, useRecordHead, useRecordTitle, type RecordHead } from "../frame/PageHead.tsx";
import { clients } from "../content.ts";
import { rememberClient } from "../lib/client-search.ts";
import { phoneWords } from "../lib/phone.ts";
import { clientPath, type ClientTab } from "../route.ts";
import shared from "./clients.module.css";
import styles from "./client-screen.module.css";
import { useBookVisit, type Booking } from "./BookOne.tsx";
import { ClientAside } from "./ClientAside.tsx";
import { ClientPackage } from "./ClientPackage.tsx";
import { Consents } from "./Consents.tsx";
import { Erased, ErasedRecord, NoClient } from "./Erase.tsx";
import { History } from "./History.tsx";
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

/** Fitted is done; Booked is under way; nothing booked is a client to win back, said plainly. */
const STATE_TONES = { fitted: "done", lead: "attention", nothing_booked: "neutral" } as const;

/** The head's badges and facts: where they stand, a replacement past its day; their number, city, since and package. */
function headOf(record: ClientRecord): RecordHead {
  const due = record.history.replacement_due;
  const late = due !== null && due.on < todayInIndia(apiNow());
  return {
    badges: [
      { words: clients.states[record.state], tone: STATE_TONES[record.state] },
      ...(late ? [{ words: clients.head.replacementLate, tone: "error" as const }] : []),
    ],
    facts: [
      phoneWords(record.mobile),
      ...(record.address === null ? [] : [record.address.city]),
      clients.head.since(shortMonth(indiaDate(record.known_since).slice(0, 7))),
      ...(record.package === null ? [] : [record.package.name]),
    ],
  };
}

/** A chat with the client in WhatsApp, in a new tab. */
function WhatsApp({ record }: { record: ClientRecord }) {
  return (
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
  );
}

/** The client's name, badges and facts as the page's head, with Call, WhatsApp and Book a visit at its right. */
function Head({ record, booking }: { record: ClientRecord; booking: Booking }) {
  useRecordTitle(record.name);
  useRecordHead(useMemo(() => headOf(record), [record]));
  const mobile = phoneWords(record.mobile);
  return (
    <PageActions>
      <ButtonLink
        variant="outline"
        size="small"
        href={`tel:${record.mobile}`}
        aria-label={clients.callLabel(record.name, mobile)}
      >
        <Icon d={GLYPHS.phone} size="sm" className={shared.icon} />
        {clients.head.call}
      </ButtonLink>
      <WhatsApp record={record} />
      {booking.mayBook && (
        <Button
          variant="primary"
          size="small"
          onClick={(event) => {
            booking.open(event.currentTarget);
          }}
        >
          {clients.visits.book.open}
        </Button>
      )}
    </PageActions>
  );
}

/** What a tab draws: from the record the page holds, or what it reads for itself. */
interface TabProps {
  readonly clientId: string;
  readonly tab: ClientTab;
  readonly record: ClientRecord;
  readonly booking: Booking;
  readonly credits: Credits;
  readonly onCredits: (credits: Credits) => void;
  readonly attached: Attached | null;
  readonly onAttached: (attached: Attached) => void;
  readonly onChanged: () => void;
  readonly onErased: () => void;
  readonly photos: ReturnType<typeof usePhotos>;
}

function Tab(props: TabProps) {
  const { clientId, tab, record } = props;
  if (tab === "visits") return <Visits record={record} booking={props.booking} onChanged={props.onChanged} />;
  if (tab === "pieces")
    return (
      <>
        <Pieces clientId={clientId} />
        <ClientPackage clientId={clientId} record={record} onChanged={props.onChanged} />
      </>
    );
  if (tab === "payments")
    return (
      <Payments
        clientId={clientId}
        payments={record.payments}
        links={record.payment_links}
        invoices={record.invoices}
        credits={props.credits}
        onCredits={props.onCredits}
      />
    );
  if (tab === "messages")
    return <ClientChat clientId={clientId} mobile={record.mobile} none={<WhatsApp record={record} />} />;
  if (tab === "referrals")
    return (
      <Invite
        clientId={clientId}
        invite={props.attached?.invite ?? record.invite}
        news={props.attached?.news ?? null}
        onInvite={(invite, news) => {
          props.onAttached({ invite, news });
        }}
      />
    );
  if (tab === "consents") return <Consents clientId={clientId} name={record.name} onErased={props.onErased} />;
  if (tab === "history") return <History clientId={clientId} history={record.history} />;
  return <Photos photos={props.photos} name={record.name} />;
}

/** The tabs, one row that scrolls on a phone, and the tab chosen beneath, its panel unheaded where it is titled so. */
function TabBody(props: TabProps) {
  const label = clients.tabs.find((each) => each.tab === props.tab)?.label ?? null;
  return (
    <div className={styles.main}>
      <Tabs label={props.record.name}>
        {clients.tabs.map((each) => (
          <OpsLink
            key={each.tab}
            className={TAB}
            to={clientPath(props.clientId, each.tab)}
            current={each.tab === props.tab}
          >
            {each.label}
          </OpsLink>
        ))}
      </Tabs>
      <PageTitle.Provider value={label}>
        <Stack>
          <Tab {...props} />
        </Stack>
      </PageTitle.Provider>
    </div>
  );
}

function ClientPage({
  clientId,
  tab,
  record,
  retry,
  photos,
  onErased,
}: {
  clientId: string;
  tab: ClientTab;
  record: ClientRecord;
  retry: () => void;
  photos: ReturnType<typeof usePhotos>;
  onErased: () => void;
}) {
  // What the credit form last answered, which stands over the record read when the page opened.
  const [adjusted, setAdjusted] = useState<{ credits: Credits } | null>(null);
  const [attached, setAttached] = useState<Attached | null>(null);
  // An address a client gave on the phone, saved on this page, which stands over the one read on opening.
  const [given, setGiven] = useState<{ address: NonNullable<Address> } | null>(null);
  const booking = useBookVisit(clientId, record, retry);
  const credits = adjusted === null ? record.credits : adjusted.credits;
  return (
    <div className={shared.client}>
      <Head record={record} booking={booking} />
      {booking.panel}
      <OpenTasks clientId={clientId} name={record.name} />
      <div className={styles.columns}>
        <TabBody
          clientId={clientId}
          tab={tab}
          record={record}
          booking={booking}
          credits={credits}
          onCredits={(next) => {
            setAdjusted({ credits: next });
          }}
          attached={attached}
          onAttached={setAttached}
          onChanged={retry}
          onErased={onErased}
          photos={photos}
        />
        <ClientAside
          clientId={clientId}
          record={record}
          credits={credits}
          address={given?.address ?? record.address}
          onAddress={(address) => {
            setGiven({ address });
          }}
        />
      </div>
    </div>
  );
}

export function ClientScreen({ clientId, tab }: { clientId: string; tab: ClientTab }) {
  const load = useCallback(() => api.client(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);
  const photos = usePhotos(clientId);
  const [erasedId, setErasedId] = useState<string | null>(null);
  // Offered again on the Clients page, for the rest of the session.
  const opened = loaded.state === "loaded" && !isErased(loaded.value) ? loaded.value.name : null;
  useEffect(() => {
    if (opened !== null) rememberClient({ id: clientId, name: opened });
  }, [clientId, opened]);

  if (erasedId === clientId) return <Erased />;
  return whenLoaded(loaded, {
    loading: <PanelLoading />,
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
        <ClientPage
          clientId={clientId}
          tab={tab}
          record={record}
          retry={retry}
          photos={photos}
          onErased={() => {
            setErasedId(clientId);
          }}
        />
      ),
  });
}
