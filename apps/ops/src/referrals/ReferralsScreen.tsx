// Referrals (Ops Console, boards C1 and C2): the grants the fraud rules held,
// each approved or rejected here, over every referrer's figures. Approving a
// grant releases its credits. The board asks for a reason on either decision,
// the server refuses one without it, and it is kept with the decision under
// whoever Access says is signed in (docs/decisions/0048-referrals.md,
// src/policy/decision-reasons.ts).
//
// Each name in a held pair is a way to that client's page, and each grant says
// how long it has been held, as the board writes it.

import { Button } from "@maneman/ui/Button";
import { Field, TextArea } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useEffect, useRef, useState } from "react";
import { api, type Held, type Referrer } from "../api.ts";
import { DecisionQueue } from "../components/DecisionQueue.tsx";
import { OpsLink, Shell } from "../components/Shell.tsx";
import { referrals } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { daysUntil } from "../lib/due.ts";
import { clientPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./referrals.module.css";

type Choice = "approve" | "reject";

/** Where a row is in its decision: waiting, asked for a reason, sending, or refused by the API. */
type Decision =
  | { readonly step: "open" }
  | { readonly step: "asking"; readonly choice: Choice }
  | { readonly step: "sending"; readonly choice: Choice }
  | { readonly step: "failed"; readonly code: string };

const HOUR = 3_600_000;

/** "3 days held", and "5 hours held" under a day, as board C1 writes how long a grant has waited. */
function heldFor(since: string, now: Date): string {
  const hours = Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / HOUR));
  return hours < 24 ? referrals.queue.held(hours, "hour") : referrals.queue.held(Math.floor(hours / 24), "day");
}

interface HeldGrantProps {
  readonly grant: Held;
  readonly now: Date;
  /** Whether the person's access lets them approve or reject it. */
  readonly mayDecide: boolean;
  readonly onDecided: () => void;
}

function HeldGrant({ grant, now, mayDecide, onDecided }: HeldGrantProps) {
  const [decision, setDecision] = useState<Decision>({ step: "open" });
  const [reason, setReason] = useState("");
  const openers = { approve: useRef<HTMLButtonElement>(null), reject: useRef<HTMLButtonElement>(null) };
  const copy = referrals.queue;

  const decide = async (choice: Choice) => {
    setDecision({ step: "sending", choice });
    const answer = await api.decideReferral(grant.id, choice, reason.trim());
    if (answer.ok) onDecided();
    else setDecision({ step: "failed", code: answer.code });
  };

  /** Back to the two buttons, and the keyboard back to the one that asked, rather than to the top of the page. */
  const keepHeld = (from: Choice) => {
    setDecision({ step: "open" });
    requestAnimationFrame(() => openers[from].current?.focus());
  };

  // Both decisions are made in the same two steps, so the reason is asked for either way.
  const asking = decision.step === "asking" || decision.step === "sending" ? decision : null;
  const sending = decision.step === "sending";
  const overdue = daysUntil(grant.due, now) < 0;
  return (
    <>
      <div className={styles.grantHead}>
        <span className={styles.pair}>
          <OpsLink className={styles.person} to={clientPath(grant.referrer.person_id, "visits")}>
            {grant.referrer.name}
          </OpsLink>{" "}
          {copy.arrow}{" "}
          <OpsLink className={styles.person} to={clientPath(grant.referred.person_id, "referrals")}>
            {grant.referred.name}
          </OpsLink>
        </span>
        <span className={overdue ? styles.late : styles.when}>{heldFor(grant.held_since, now)}</span>
      </div>
      <ul className={styles.signals}>
        {grant.signals.map((signal) => (
          <li key={signal} className={styles.signal}>
            {copy.signals[signal]}
          </li>
        ))}
      </ul>
      {asking !== null && (
        <div className={styles.reason}>
          <Field label={copy.reason.label[asking.choice]} hint={copy.reason.hint}>
            {(control) => (
              <TextArea
                {...control}
                className={styles.reasonField}
                maxLength={300}
                // The field stands where the button that asked for it stood, so the keyboard goes to it.
                autoFocus
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
            )}
          </Field>
          <div className={styles.actions}>
            <Button
              variant={asking.choice === "approve" ? "primary" : "danger"}
              size="small"
              disabled={sending || reason.trim() === ""}
              onClick={() => void decide(asking.choice)}
            >
              {sending ? copy.deciding : copy.reason.confirm[asking.choice]}
            </Button>
            <Button
              variant="outline"
              size="small"
              className={styles.quiet}
              disabled={sending}
              onClick={() => {
                keepHeld(asking.choice);
              }}
            >
              {copy.reason.cancel}
            </Button>
          </div>
        </div>
      )}
      {asking === null && mayDecide && (
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="small"
            ref={openers.approve}
            className={styles.approve}
            onClick={() => {
              setDecision({ step: "asking", choice: "approve" });
            }}
          >
            {copy.approve}
          </Button>
          <Button
            variant="danger"
            size="small"
            ref={openers.reject}
            className={styles.reject}
            onClick={() => {
              setDecision({ step: "asking", choice: "reject" });
            }}
          >
            {copy.reject}
          </Button>
        </div>
      )}
      {decision.step === "failed" && (
        <p className={styles.error} role="alert">
          {copy.errors[decision.code] ?? copy.errors.unknown}
        </p>
      )}
    </>
  );
}

/** Board C1's queue. A decision can change the referrers' figures beneath, so each one tells the page. */
function ReviewQueue({ onDecided }: { onDecided: () => void }) {
  const [loaded, retry] = useLoad(api.held);
  const mayDecide = useAccess().mayCall("POST /api/referrals/{id}/decision");
  const copy = referrals.queue;
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const now = new Date();
  return (
    <DecisionQueue titleId="held" title={copy.title} items={loaded.value.held} rowKind="held" empty={copy.empty}>
      {(grant, decided) => (
        <HeldGrant
          grant={grant}
          now={now}
          mayDecide={mayDecide}
          onDecided={() => {
            decided();
            onDecided();
          }}
        />
      )}
    </DecisionQueue>
  );
}

/** The referrers read so far, a page at a time, and whether another follows. */
type Pages =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly requestId: string | null }
  | {
      readonly state: "loaded";
      readonly referrers: readonly Referrer[];
      readonly more: boolean;
      readonly fetching: boolean;
    };

/**
 * The referrers, the busiest first, a page at a time. The first page is read
 * again at every new `version`, since a decision above may have moved a figure.
 */
function useReferrers(version: number) {
  const [pages, setPages] = useState<Pages>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void api.referrers(0).then((answer) => {
      if (!current) return;
      setPages(
        answer.ok
          ? { state: "loaded", referrers: answer.body.referrers, more: answer.body.more, fetching: false }
          : { state: "failed", requestId: answer.requestId },
      );
    });
    return () => {
      current = false;
    };
  }, [version, attempt]);

  const more = async (shown: Extract<Pages, { state: "loaded" }>) => {
    setPages({ ...shown, fetching: true });
    const answer = await api.referrers(shown.referrers.length);
    if (!answer.ok) {
      setPages({ ...shown, fetching: false });
      return;
    }
    setPages({
      state: "loaded",
      referrers: [...shown.referrers, ...answer.body.referrers],
      more: answer.body.more,
      fetching: false,
    });
  };

  const retry = () => {
    setPages({ state: "loading" });
    setAttempt((count) => count + 1);
  };
  return { pages, more, retry } as const;
}

function ReferrersTable({ version }: { version: number }) {
  const { pages, more, retry } = useReferrers(version);
  const copy = referrals.table;

  if (pages.state === "loading") return <Loading />;
  if (pages.state === "failed") return <PanelFailed onRetry={retry} requestId={pages.requestId} />;

  return (
    <section className={styles.panel} aria-labelledby="referrers">
      <div className={styles.panelBody}>
        {/* The board's frame opens on the column heads; the caption above it is the board's own furniture. */}
        <VisuallyHidden as="h2" id="referrers">
          {copy.title}
        </VisuallyHidden>
        {pages.referrers.length === 0 ? (
          <p className={styles.empty}>{copy.empty}</p>
        ) : (
          <Table className={styles.table}>
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
              {pages.referrers.map((referrer) => (
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
          </Table>
        )}
        {pages.more && (
          <div className={styles.actions}>
            <Button
              variant="outline"
              size="small"
              className={styles.quiet}
              disabled={pages.fetching}
              onClick={() => void more(pages)}
            >
              {pages.fetching ? copy.loading : copy.more}
            </Button>
          </div>
        )}
        <p className={styles.note}>{copy.note}</p>
      </div>
    </section>
  );
}

export function ReferralsScreen() {
  // A decision can change the referrers' figures beneath, so each one reads them again.
  const [version, setVersion] = useState(0);
  return (
    <Shell section="/referrals" title={referrals.title}>
      <div className={styles.column}>
        <ReviewQueue
          onDecided={() => {
            setVersion((count) => count + 1);
          }}
        />
        <ReferrersTable version={version} />
      </div>
    </Shell>
  );
}
