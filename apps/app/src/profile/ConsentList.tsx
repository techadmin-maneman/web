// "What you have agreed to": each purpose with its date and a
// switch. Turning referral cards on first shows the lines its notice carries
//, so the consent recorded is one the client has read. A switch
// moves only once the API has recorded it; one that did not go through says so
// and stays as it was, since a switch that looks off while the consent stands
// would tell the client something untrue about their data. Where switching a
// purpose off leaves something as it was, a line says so.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Switch } from "@maneman/ui/Switch";
import { NoticeLine } from "@maneman/ui/NoticeLine";
import { CLIENT_WORDS } from "@maneman/web-kit/client-words";
import { capsLook } from "@maneman/ui/Caps";
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

function VisitPhotos() {
  return (
    <li className={shared.consent}>
      <PhotosLine says={profile.visitPhotos} className={shared.consentName} />
    </li>
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

  return (
    <section aria-labelledby="agreed" aria-busy={busy}>
      <h2 className={capsLook(shared.label)} id="agreed">
        {copy.agreed}
      </h2>
      <ul className={shared.consents}>
        <VisitPhotos />
        {consents
          .filter((consent) => !NO_SWITCH.includes(consent.purpose))
          .map((consent) => {
            const name = copy.purposes[consent.purpose];
            return (
              <li key={consent.purpose} className={shared.consent}>
                <div className={shared.consentRow}>
                  <div>
                    <p className={shared.consentName} id={`consent-${consent.purpose}`}>
                      {name}
                    </p>
                    {consent.granted && consent.since !== null && (
                      <p className={shared.consentWhen}>{copy.given(longDate(consent.since))}</p>
                    )}
                  </div>
                  <Switch
                    checked={consent.granted}
                    labelledBy={`consent-${consent.purpose}`}
                    onToggle={() => {
                      setFailed(null);
                      if (!consent.granted && consent.purpose === "photos_referral_cards")
                        setConfirming(consent.purpose);
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
                  <div className={shared.confirm}>
                    <PhotosLine says={copy.referralCards.line} className={styles.line} />
                    <div className={shared.row}>
                      <Button
                        variant="primary"
                        size="control"
                        className={shared.primary}
                        disabled={busy}
                        onClick={() => void switchTo(consent.purpose, true)}
                      >
                        {copy.referralCards.confirm}
                      </Button>
                      <Button
                        variant="quiet"
                        size="control"
                        className={shared.secondary}
                        onClick={() => {
                          setConfirming(null);
                          setFailed(null);
                        }}
                      >
                        {copy.referralCards.cancel}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
      </ul>
    </section>
  );
}
