// "What you have agreed to" (board G1): each purpose with its date and a
// switch. Turning referral cards on first shows the lines its notice carries
// (board F3), so the consent recorded is one the client has read. A switch
// moves only once the API has recorded it; one that did not go through says so
// and stays as it was, since a switch that looks off while the consent stands
// would tell the client something untrue about their data. Visit messages off,
// a line says what that means.

import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type ConsentPurpose, type Profile } from "../api.ts";
import { profile } from "../content.ts";
import styles from "./profile.module.css";

type Consent = Profile["consents"][number];

export function ConsentList({ consents }: { consents: readonly Consent[] }) {
  const copy = profile;
  const [shown, setShown] = useState(consents);
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
      setShown((list) =>
        list.map((consent) =>
          consent.purpose === purpose ? { purpose, granted: answer.body.granted, since: answer.body.since } : consent,
        ),
      );
    });

  return (
    <section aria-labelledby="agreed" aria-busy={busy}>
      <h2 className={styles.label} id="agreed">
        {copy.agreed}
      </h2>
      <ul className={styles.consents}>
        {shown.map((consent) => {
          const name = copy.purposes[consent.purpose];
          return (
            <li key={consent.purpose} className={styles.consent}>
              <div className={styles.consentRow}>
                <div>
                  <p className={styles.consentName} id={`consent-${consent.purpose}`}>
                    {name}
                  </p>
                  <p className={styles.consentWhen}>
                    {consent.granted && consent.since !== null ? copy.given(longDate(consent.since)) : copy.notGiven}
                  </p>
                </div>
                <button
                  className={styles.switch}
                  type="button"
                  role="switch"
                  aria-checked={consent.granted}
                  aria-labelledby={`consent-${consent.purpose}`}
                  onClick={() => {
                    setFailed(null);
                    if (!consent.granted && consent.purpose === "photos_referral_cards") setConfirming(consent.purpose);
                    else void switchTo(consent.purpose, !consent.granted);
                  }}
                >
                  <span className={styles.knob} />
                </button>
              </div>
              {consent.purpose === "whatsapp_visits" && (
                // Always in the page, so a screen reader hears the line come and go with the switch.
                <div role="status">{!consent.granted && <p className={styles.consequence}>{copy.visitsOff}</p>}</div>
              )}
              {failed === consent.purpose && (
                <p className={styles.error} role="alert">
                  {copy.switchFailed}
                </p>
              )}
              {confirming === consent.purpose && (
                <div className={styles.confirm}>
                  <ul className={styles.lines}>
                    {copy.referralCards.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <div className={styles.row}>
                    <Button
                      variant="primary"
                      size="control"
                      className={styles.primary}
                      disabled={busy}
                      onClick={() => void switchTo(consent.purpose, true)}
                    >
                      {copy.referralCards.confirm}
                    </Button>
                    <Button
                      variant="outline"
                      size="control"
                      className={styles.secondary}
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
