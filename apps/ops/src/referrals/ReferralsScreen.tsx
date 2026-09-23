// Referrals (Ops Console, boards C1 and C2): the grants the fraud rules held,
// each approved or rejected here, over every referrer's figures. Approving a
// grant releases its credits. The board asks for a reason on either decision,
// and both are recorded in the audit log under whoever Access says is signed
// in (docs/decisions/0048-referrals.md).

import { shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type Held } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { referrals } from "../content.ts";
import { useLoad } from "../lib/useLoad.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./referrals.module.css";

type Choice = "approve" | "reject";

/** Where a row is in its decision: waiting, asked for a reason, sending, or refused by the API. */
type Decision =
  | { readonly step: "open" }
  | { readonly step: "asking"; readonly choice: Choice }
  | { readonly step: "sending"; readonly choice: Choice }
  | { readonly step: "failed"; readonly code: string };

function HeldGrant({ grant, onDecided }: { grant: Held; onDecided: () => void }) {
  const [decision, setDecision] = useState<Decision>({ step: "open" });
  const [reason, setReason] = useState("");
  const copy = referrals.queue;

  const decide = async (choice: Choice) => {
    setDecision({ step: "sending", choice });
    const answer = await api.decideReferral(grant.id, choice, reason.trim());
    if (answer.ok) onDecided();
    else setDecision({ step: "failed", code: answer.code });
  };

  // Both decisions are made in the same two steps, so the reason is asked for either way.
  const asking = decision.step === "asking" || decision.step === "sending" ? decision : null;
  const sending = decision.step === "sending";
  return (
    <li className={styles.grant}>
      <div className={styles.grantHead}>
        <span className={styles.pair}>{copy.pair(grant.referrer.name, grant.referred.name)}</span>
        <span className={styles.when}>{copy.fitted(shortDate(grant.fitted_on))}</span>
      </div>
      <ul className={styles.signals}>
        {grant.signals.map((signal) => (
          <li key={signal} className={styles.signal}>
            {copy.signals[signal]}
          </li>
        ))}
      </ul>
      {asking !== null ? (
        <div className={styles.reason}>
          <label className={styles.reasonLabel} htmlFor={`reason-${grant.id}`}>
            {copy.reason.label[asking.choice]}
          </label>
          <textarea
            id={`reason-${grant.id}`}
            className={styles.reasonField}
            maxLength={300}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <p className={styles.reasonHint}>{copy.reason.hint}</p>
          <div className={styles.actions}>
            <button
              className={asking.choice === "approve" ? styles.approve : styles.reject}
              type="button"
              disabled={sending || reason.trim() === ""}
              onClick={() => void decide(asking.choice)}
            >
              {sending ? copy.deciding : copy.reason.confirm[asking.choice]}
            </button>
            <button
              className={styles.quiet}
              type="button"
              disabled={sending}
              onClick={() => {
                setDecision({ step: "open" });
              }}
            >
              {copy.reason.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            className={styles.approve}
            type="button"
            onClick={() => {
              setDecision({ step: "asking", choice: "approve" });
            }}
          >
            {copy.approve}
          </button>
          <button
            className={styles.reject}
            type="button"
            onClick={() => {
              setDecision({ step: "asking", choice: "reject" });
            }}
          >
            {copy.reject}
          </button>
        </div>
      )}
      {decision.step === "failed" && (
        <p className={styles.error} role="alert">
          {copy.errors[decision.code] ?? copy.errors.unknown}
        </p>
      )}
    </li>
  );
}

function ReviewQueue() {
  const [loaded, retry] = useLoad(api.held);
  // A decided grant leaves the queue at once; the count follows it.
  const [decided, setDecided] = useState<readonly string[]>([]);
  const copy = referrals.queue;

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  const waiting = loaded.value.held.filter((grant) => !decided.includes(grant.id));
  return (
    <section className={styles.panel} aria-labelledby="held">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="held">
          {copy.title}
        </h2>
        <span className={styles.count}>{waiting.length}</span>
      </div>
      {waiting.length === 0 ? (
        <p className={styles.empty}>{copy.empty}</p>
      ) : (
        <ul className={styles.grants}>
          {waiting.map((grant) => (
            <HeldGrant
              key={grant.id}
              grant={grant}
              onDecided={() => {
                setDecided((already) => [...already, grant.id]);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReferrersTable() {
  const [loaded, retry] = useLoad(api.referrers);
  const copy = referrals.table;

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;

  return (
    <section className={styles.panel} aria-labelledby="referrers">
      <div className={styles.panelBody}>
        {/* The board's frame opens on the column heads; the caption above it is the board's own furniture. */}
        <h2 className={styles.hiddenTitle} id="referrers">
          {copy.title}
        </h2>
        {loaded.value.referrers.length === 0 ? (
          <p className={styles.empty}>{copy.empty}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                {copy.columns.map((column, index) => (
                  <th key={column} scope="col" className={index === 0 ? styles.name : styles.figure}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loaded.value.referrers.map((referrer) => (
                <tr key={referrer.code}>
                  <th scope="row" className={styles.name}>
                    {referrer.name}
                  </th>
                  <td className={styles.quietFigure}>{referrer.opens}</td>
                  <td className={styles.quietFigure}>{referrer.consultations}</td>
                  <td className={styles.figure}>{referrer.fits}</td>
                  <td className={styles.figure}>{referrer.granted}</td>
                  <td className={styles.quietFigure}>{referrer.redeemed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className={styles.note}>{copy.note}</p>
      </div>
    </section>
  );
}

export function ReferralsScreen() {
  return (
    <Shell section="/referrals" title={referrals.title}>
      <div className={styles.column}>
        <ReviewQueue />
        <ReferrersTable />
      </div>
    </Shell>
  );
}
