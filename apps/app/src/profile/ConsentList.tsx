// Privacy and messages: the photographs, then WhatsApp, each purpose with a switch, its date once given, and what it
// covers or what being off means. Turning referral cards on first shows the lines its notice carries
//, so the consent recorded is one the client has read. A switch
// moves only once the API has recorded it; one that did not go through says so
// and stays as it was, since a switch that looks off while the consent stands
// would tell the client something untrue about their data. Where switching a
// purpose off leaves something as it was, a line says so.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Switch } from "@maneman/ui/Switch";
import { NoticeLine } from "@maneman/ui/NoticeLine";
import { CLIENT_WORDS } from "@maneman/web-kit/client-words";
import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type ConsentPurpose, type Profile } from "../api.ts";
import { profile } from "../content.ts";
import { noticeUrl } from "../lib/notices.ts";
import shared from "./profile.module.css";
import styles from "./consent-list.module.css";

export type Consent = Profile["consents"][number];

/** What switching each of these off means, said while it is off. */
const WHEN_OFF: Partial<Record<ConsentPurpose, string>> = {
  whatsapp_visits: profile.visitsOff,
};

/** Every visit is photographed for the client's record: a line in the list, never a switch. */
const NO_SWITCH: readonly ConsentPurpose[] = ["photos_own_record"];

/** A line on photographs, with its link to the notice's section on them. */
function PhotosLine({ says, className }: { says: string; className: string | undefined }) {
  return (
    <p className={className}>
      <NoticeLine line={{ says, link: null }} href={noticeUrl("photos")} more={CLIENT_WORDS.noticeMore} />
    </p>
  );
}

/** A purpose's group: the photographs, or WhatsApp. */
const groupOf = (purpose: ConsentPurpose): "photos" | "whatsapp" =>
  purpose.startsWith("photos") ? "photos" : "whatsapp";

/** Beneath a purpose's name: what it covers, the day it was given, or what being off means. */
function noteOf(consent: Consent): string | null {
  const covers = profile.purposeNotes[consent.purpose] ?? null;
  if (consent.granted && consent.since !== null) {
    const given = profile.given(longDate(consent.since));
    return covers === null ? given : `${covers} · ${given}`;
  }
  return covers ?? (consent.granted ? null : (profile.purposeOff[consent.purpose] ?? null));
}

/** Turning referral cards on: the line its notice carries first, so the consent recorded is one the client has read. */
function CardsConfirm({ busy, onConfirm, onCancel }: { busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const copy = profile.referralCards;
  return (
    <div className={shared.confirm}>
      <PhotosLine says={copy.line} className={styles.line} />
      <div className={shared.row}>
        <Button variant="primary" size="control" className={shared.primary} disabled={busy} onClick={onConfirm}>
          {copy.confirm}
        </Button>
        <Button variant="quiet" size="control" className={shared.secondary} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </div>
  );
}

/** The consents as the profile holds them, which a switch the API recorded changes there. */
export function ConsentList({
  consents,
  onSwitched,
}: {
  consents: readonly Consent[];
  onSwitched: (consent: Consent) => void;
}) {
  const copy = profile;
  const [confirming, setConfirming] = useState<ConsentPurpose | null>(null);
  const [failed, setFailed] = useState<ConsentPurpose | null>(null);
  // One switch at a time: each is a row in an append-only ledger, and two taps would be two agreements.
  const [busy, once] = useOneAtATime();

  const switchTo = (purpose: ConsentPurpose, granted: boolean) =>
    once(async () => {
      const answer = await api.switchConsent(purpose, granted, "app_profile");
      if (!answer.ok) {
        setFailed(purpose);
        return;
      }
      setFailed(null);
      setConfirming(null);
      onSwitched({ purpose, granted: answer.body.granted, since: answer.body.since });
    });

  const row = (consent: Consent) => {
    const note = noteOf(consent);
    return (
      <li key={consent.purpose} className={shared.consent}>
        <div className={shared.consentRow}>
          <div>
            <p className={shared.consentName} id={`consent-${consent.purpose}`}>
              {copy.purposes[consent.purpose]}
            </p>
            {note !== null && <p className={shared.consentWhen}>{note}</p>}
          </div>
          <Switch
            checked={consent.granted}
            labelledBy={`consent-${consent.purpose}`}
            onToggle={() => {
              setFailed(null);
              if (!consent.granted && consent.purpose === "photos_referral_cards") setConfirming(consent.purpose);
              else void switchTo(consent.purpose, !consent.granted);
            }}
          />
        </div>
        {WHEN_OFF[consent.purpose] !== undefined && (
          // Always in the page, so a screen reader hears the line come and go with the switch.
          <div role="status">
            {!consent.granted && <p className={shared.consequence}>{WHEN_OFF[consent.purpose]}</p>}
          </div>
        )}
        {failed === consent.purpose && (
          <InlineMessage tone="error" className={shared.error}>
            {copy.switchFailed}
          </InlineMessage>
        )}
        {confirming === consent.purpose && (
          <CardsConfirm
            busy={busy}
            onConfirm={() => void switchTo(consent.purpose, true)}
            onCancel={() => {
              setConfirming(null);
              setFailed(null);
            }}
          />
        )}
      </li>
    );
  };

  const switches = consents.filter((consent) => !NO_SWITCH.includes(consent.purpose));
  const group = (which: "photos" | "whatsapp") => switches.filter((consent) => groupOf(consent.purpose) === which);
  return (
    <div className={styles.groups} aria-busy={busy}>
      <section aria-labelledby="photos">
        <h2 className={styles.group} id="photos">
          {copy.groups.photos}
        </h2>
        <PhotosLine says={copy.visitPhotos} className={styles.intro} />
        <ul className={shared.consents}>{group("photos").map(row)}</ul>
      </section>
      <section aria-labelledby="whatsapp">
        <h2 className={styles.group} id="whatsapp">
          {copy.groups.whatsapp}
        </h2>
        <ul className={shared.consents}>{group("whatsapp").map(row)}</ul>
      </section>
      <p className={styles.footnote}>{copy.switchingOff}</p>
    </div>
  );
}
