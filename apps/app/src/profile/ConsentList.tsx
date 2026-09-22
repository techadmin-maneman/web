// "What you have agreed to" (board G1): each purpose with its date and a
// switch. Turning referral cards on first shows the four lines its notice
// carries (board F3), so the consent recorded is one the client has read.

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

  async function switchTo(purpose: ConsentPurpose, granted: boolean) {
    setConfirming(null);
    const answer = await api.switchConsent(purpose, granted);
    if (answer.ok) {
      setShown((list) =>
        list.map((consent) =>
          consent.purpose === purpose ? { purpose, granted: answer.body.granted, since: answer.body.since } : consent,
        ),
      );
    }
  }

  return (
    <section aria-labelledby="agreed">
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
                    if (!consent.granted && consent.purpose === "photos_referral_cards") setConfirming(consent.purpose);
                    else void switchTo(consent.purpose, !consent.granted);
                  }}
                >
                  <span className={styles.knob} />
                </button>
              </div>
              {confirming === consent.purpose && (
                <div className={styles.confirm}>
                  <ul className={styles.lines}>
                    {copy.referralCards.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <div className={styles.row}>
                    <button
                      className={styles.primary}
                      type="button"
                      onClick={() => void switchTo(consent.purpose, true)}
                    >
                      {copy.referralCards.confirm}
                    </button>
                    <button
                      className={styles.secondary}
                      type="button"
                      onClick={() => {
                        setConfirming(null);
                      }}
                    >
                      {copy.referralCards.cancel}
                    </button>
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
