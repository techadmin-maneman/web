// Payments: the day's money over the charges kept on it, then the disputed charges (Disputes.tsx), then each no-show
// case with its evidence, charged or waived here, then today's rulings
// (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md). A ruling needs a reason and a charge is asked about once
// more; the server never charges by itself (src/policy/no-show.ts).

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { EmptyState } from "@maneman/ui/EmptyState";
import { DateInput, Label, TextArea } from "@maneman/ui/Field";
import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { useFocusOnMount } from "@maneman/ui/useFocusOnMount";
import { errorText } from "@maneman/web-kit/refusal";
import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { Panel } from "@maneman/ui/Panel";
import { type Loaded, useLoad } from "@maneman/ui/useLoad";
import { indiaClock, indiaDate, minutesBetween, shortDate, todayInIndia } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { api, type ChargePreview, type DecidedNoShow, type NoShowCase } from "../api.ts";
import { DecisionQueue } from "../components/DecisionQueue.tsx";
import { OpsLink } from "../components/Shell.tsx";
import { firstShown, noShows } from "../content.ts";
import { useAccess, WAIVING_A_NO_SHOW } from "../lib/access.ts";
import { Left } from "../lib/Left.tsx";
import { clientPath } from "../route.ts";
import { Charges } from "./Charges.tsx";
import { Disputes } from "./Disputes.tsx";
import { Distance } from "./Distance.tsx";
import { Loading, PanelFailed } from "../states/States.tsx";
import styles from "./no-shows.module.css";

type Choice = "charged" | "waived";

/** India's date today, by this computer's clock. */
const indiaToday = () => todayInIndia(Date.now());

/** The card's heading, which names the day its figures are for, and the field that asks for another day. */
function DayHead({ date, shown, onDay }: { date: string; shown: string; onDay: (date: string) => void }) {
  const copy = noShows.money;
  const today = indiaToday();
  return (
    <div className={styles.dayHead}>
      <h2 className={styles.dayTitle} id="day-money">
        {copy.title(shortDate(date), date === today)}
      </h2>
      <div>
        <Label className={styles.dayLabel} htmlFor="money-day">
          {copy.pick}
        </Label>
        <DateInput
          className={styles.dayField}
          id="money-day"
          max={today}
          value={shown}
          onChange={(event) => {
            if (event.target.value !== "") onDay(event.target.value);
          }}
        />
      </div>
    </div>
  );
}

function Money() {
  // The day asked for; null for today, which the API answers when it is given no date.
  const [asked, setAsked] = useState<string | null>(null);
  const load = useCallback(() => api.dayMoney(asked), [asked]);
  const [loaded, retry] = useLoad(load);
  const copy = noShows.money;

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const day = loaded.value;
  const isToday = day.date === indiaToday();
  return (
    <section className={styles.panel} aria-labelledby="day-money">
      <DayHead date={day.date} shown={asked ?? day.date} onDay={setAsked} />
      <dl className={styles.figures}>
        <div className={styles.figure}>
          <dt className={styles.figureName}>{copy.figures.collected(isToday)}</dt>
          <dd className={styles.amount}>{rupees(day.collected)}</dd>
        </div>
        <div className={styles.figure}>
          <dt className={styles.figureName}>
            {copy.figures.processing}
            {day.refunded > 0 && <span className={styles.aside}>{copy.refunded(rupees(day.refunded), isToday)}</span>}
          </dt>
          <dd className={styles.amount}>{rupees(day.refunds_processing)}</dd>
        </div>
        <div className={styles.figure}>
          <dt className={styles.figureName}>{copy.figures.charged}</dt>
          <dd className={styles.amount}>{rupees(day.charged)}</dd>
        </div>
      </dl>
      <h3 className={capsLook(styles.chargesTitle)}>{copy.charges.title}</h3>
      <Charges charges={day.charges} today={isToday} more={day.more} />
    </section>
  );
}

const copy = noShows.queue;

/** "5 h 8 m after the booked start", or before it, as the Technicians page writes a length. */
function offsetOf(minutesLate: number): string {
  if (minutesLate === 0) return copy.onTime;
  const span = Math.abs(minutesLate);
  const words = copy.span(Math.floor(span / 60), span % 60);
  return minutesLate > 0 ? copy.after(words) : copy.before(words);
}

/** An instant as the queue dates one: "Fri 18 Sep, 6:03 pm". */
const datedOf = (instant: string) => copy.dated(shortDate(indiaDate(instant)), indiaClock(instant));

function bookedOf(each: NoShowCase): string {
  if (each.window_start === null || each.window_end === null) return noShows.money.charges.undated;
  return copy.booked(
    shortDate(indiaDate(each.window_start)),
    indiaClock(each.window_start),
    indiaClock(each.window_end),
  );
}

function checkInOf(each: NoShowCase): string {
  const time = indiaClock(each.checked_in_at);
  return each.minutes_late === null ? time : copy.checkIn(time, offsetOf(each.minutes_late));
}

function messageOf(each: NoShowCase): string {
  if (each.message_state === "delivered" && each.message_delivered_at !== null) {
    return copy.message.delivered(datedOf(each.message_delivered_at));
  }
  if (each.message_state === "delivered") return copy.message.sent;
  return copy.message[each.message_state];
}

/**
 * How long they waited, from the check-in to the close, and not the wait the
 * rules asked for. A check-in that reached us well after the phone's time says
 * how long it had been with us too, since that is the part our clock vouches for.
 */
function waitedOf(each: NoShowCase): string {
  if (each.closed_at === null) return copy.notClosed;
  const closed = indiaClock(each.closed_at);
  const byPhone = minutesBetween(each.checked_in_at, each.closed_at);
  const withUs = minutesBetween(each.received_at, each.closed_at);
  return byPhone === withUs ? copy.waited(byPhone, closed) : copy.waitedBoth(byPhone, withUs, closed);
}

function Facts({ each }: { each: NoShowCase }) {
  const claimed = each.phone_checked_in_at;
  const rows: readonly (readonly [string, ReactNode])[] = [
    [copy.facts.booked, bookedOf(each)],
    [copy.facts.checkIn, checkInOf(each)],
    // The phone's own word, where the bounds would not take it (src/policy/phone-clock.ts).
    ...(claimed === null || claimed === each.checked_in_at ? [] : [[copy.facts.claimed, datedOf(claimed)] as const]),
    [copy.facts.received, datedOf(each.received_at)],
    [
      copy.facts.distance,
      <Distance key="distance" metres={each.distance_m} radius={each.radius_m} letIn={each.let_in} />,
    ],
    [copy.facts.whatsapp, messageOf(each)],
    [copy.facts.waited, waitedOf(each)],
  ];

  return (
    <dl className={styles.facts}>
      {rows.map(([name, value]) => (
        <div className={styles.fact} key={name}>
          <dt className={styles.factName}>{name}</dt>
          <dd className={styles.factValue}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The case's first line: the client, a way to their page, or why there is none. */
function Client({ each }: { each: NoShowCase }) {
  if (each.person === null) return <span className={styles.visit}>{copy.erased}</span>;
  return (
    <OpsLink className={styles.client} to={clientPath(each.person.id, "visits")}>
      {each.person.name}
    </OpsLink>
  );
}

/** Where a case is in its ruling: open, a charge asked about, sending, or refused by the API. */
type Ruling =
  | { readonly step: "open" }
  | { readonly step: "confirming" }
  | { readonly step: "sending" }
  | { readonly step: "failed"; readonly code: string };

/** What charging keeps of what was paid and what it refunds, as one question: "Keep Rs. 1,234 of the Rs. 1,234 paid?" */
function chargeQuestion(preview: ChargePreview): string {
  const confirm = copy.confirm;
  const { paid, kept } = preview;
  if (paid === 0) return preview.credit_kept ? confirm.keepsCredit : confirm.nothingPaid;
  if (kept === paid) return confirm.keepsAll(rupees(paid));
  if (kept === 0) return confirm.keepsNone(rupees(paid));
  return confirm.keepsPart(rupees(kept), rupees(paid), rupees(paid - kept));
}

function questionOf(preview: Loaded<ChargePreview>): string {
  if (preview.state === "loading") return copy.confirm.working;
  if (preview.state === "failed") return copy.confirm.failed;
  return chargeQuestion(preview.value);
}

/** A charge on a visit paid for in money and with a credit keeps both, and the question names only the money. */
const keepsCreditToo = (preview: Loaded<ChargePreview>): boolean =>
  preview.state === "loaded" && preview.value.paid > 0 && preview.value.credit_kept;

/**
 * The charge, asked about once more with what it keeps and refunds; it takes the keyboard as it opens, where the
 * buttons stood. It cannot be sent until the figures are in.
 */
function ConfirmCharge({ each, onCharge, onBack }: { each: NoShowCase; onCharge: () => void; onBack: () => void }) {
  const panel = useFocusOnMount<HTMLDivElement>();
  const [preview] = useLoad(useCallback(() => api.chargePreview(each.id), [each.id]));
  const day = each.visit_date === null ? copy.noDay : shortDate(each.visit_date);
  return (
    <div
      className={styles.confirm}
      ref={panel}
      tabIndex={-1}
      role="group"
      aria-labelledby={`confirm-${each.id}`}
      aria-describedby={`confirm-who-${each.id}`}
    >
      <p className={styles.confirmLine} id={`confirm-${each.id}`}>
        {questionOf(preview)}
      </p>
      {keepsCreditToo(preview) && <p className={styles.confirmNote}>{copy.confirm.creditToo}</p>}
      <p className={styles.confirmNote} id={`confirm-who-${each.id}`}>
        {copy.confirm.who(each.person?.name ?? copy.erased, day)}
      </p>
      <div className={styles.actions}>
        <Button variant="primary" size="small" disabled={preview.state !== "loaded"} onClick={onCharge}>
          {copy.confirmCharge}
        </Button>
        <Button variant="outline" size="small" onClick={onBack}>
          {copy.back}
        </Button>
      </div>
    </div>
  );
}

/** The case as anyone who may read it sees it: the client, the visit, and the evidence. */
function CaseFacts({ each, now }: { each: NoShowCase; now: Date }) {
  return (
    <>
      <div className={styles.caseHead}>
        <Client each={each} />
        <Left due={each.due} now={now} />
      </div>
      <p className={styles.caseSub}>
        {each.visit_date === null ? copy.undated : copy.visit(shortDate(each.visit_date))}
        {each.technician !== null && ` · ${copy.attended(each.technician)}`}
      </p>
      <Facts each={each} />
      {each.closed_early && (
        <p className={styles.closedEarly} role="note">
          {copy.closedEarly}
        </p>
      )}
    </>
  );
}

/** What the person's access lets them do with a case: charge it, and waive it, which gives money back. */
interface MayRule {
  readonly charge: boolean;
  readonly waive: boolean;
}

interface CaseProps {
  readonly each: NoShowCase;
  readonly now: Date;
  readonly may: MayRule;
  readonly onDecided: () => void;
}

function Case({ each, now, may, onDecided }: CaseProps) {
  const [ruling, setRuling] = useState<Ruling>({ step: "open" });
  const [reason, setReason] = useState("");
  const chargeButton = useRef<HTMLButtonElement>(null);

  const decide = async (choice: Choice) => {
    setRuling({ step: "sending" });
    const answer = await api.decideNoShow(each.id, choice, reason.trim());
    if (answer.ok) onDecided();
    else setRuling({ step: "failed", code: answer.code });
  };

  if (!may.charge) return <CaseFacts each={each} now={now} />;

  const sending = ruling.step === "sending";
  const noReason = reason.trim() === "";
  return (
    <>
      <CaseFacts each={each} now={now} />
      <Label className={styles.reasonLabel} htmlFor={`reason-${each.id}`}>
        {copy.reason.label}
      </Label>
      <TextArea
        id={`reason-${each.id}`}
        className={styles.reasonField}
        maxLength={REASON_MAX_CHARS}
        placeholder={copy.reason.placeholder}
        value={reason}
        disabled={sending || ruling.step === "confirming"}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      {ruling.step === "confirming" ? (
        <ConfirmCharge
          each={each}
          onCharge={() => void decide("charged")}
          onBack={() => {
            setRuling({ step: "open" });
            // Back to the button that asked, rather than to the top of the page.
            requestAnimationFrame(() => chargeButton.current?.focus());
          }}
        />
      ) : (
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="small"
            ref={chargeButton}
            disabled={sending || noReason}
            onClick={() => {
              setRuling({ step: "confirming" });
            }}
          >
            {sending ? copy.deciding : copy.charge}
          </Button>
          {may.waive && (
            <Button variant="outline" size="small" disabled={sending || noReason} onClick={() => void decide("waived")}>
              {copy.waive}
            </Button>
          )}
        </div>
      )}
      {ruling.step === "failed" && (
        <InlineMessage tone="error" className={styles.error}>
          {errorText(copy.errors, { code: ruling.code })}
        </InlineMessage>
      )}
    </>
  );
}

function NoShowQueue({ onDecided }: { onDecided: () => void }) {
  const [loaded, retry] = useLoad(api.noShows);
  const access = useAccess();
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const now = new Date();
  const charge = access.mayCall("POST /api/no-shows/{id}/decision");
  const may: MayRule = { charge, waive: charge && access.reaches(WAIVING_A_NO_SHOW) };
  return (
    <DecisionQueue
      titleId="no-shows"
      title={copy.title}
      items={loaded.value.cases}
      more={loaded.value.more}
      rowKind="case"
      empty={copy.empty}
    >
      {(each, ruled) => (
        <Case
          each={each}
          now={now}
          may={may}
          onDecided={() => {
            ruled();
            onDecided();
          }}
        />
      )}
    </DecisionQueue>
  );
}

/** What a ruling did: a charge, with what it kept, or a waiver. */
function rulingOf(each: DecidedNoShow): string {
  const decided = noShows.decided;
  if (each.decision === "waived") return decided.waived;
  if (each.charge === null) return decided.chargedUnrecorded;
  if (each.charge.kept > 0) return decided.charged(rupees(each.charge.kept));
  return each.charge.credit_spent ? decided.chargedCredit : decided.chargedNothing;
}

/** The cases ruled on today, the latest first, so a case ops have just charged or waived can still be seen. */
function DecidedToday() {
  const [loaded, retry] = useLoad(api.decidedNoShows);
  const decided = noShows.decided;
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const { cases, more } = loaded.value;
  return (
    <Panel titleId="decided-today" title={decided.title}>
      {cases.length === 0 ? (
        <EmptyState look="panel" line={decided.empty} />
      ) : (
        <ul className={styles.charges}>
          {cases.map((each) => (
            <li className={styles.chargeRow} key={each.id}>
              <div className={styles.chargeLine}>
                <span className={styles.who}>{each.person?.name ?? copy.erased}</span>
                <span className={styles.ruling}>{decided.at(rulingOf(each), indiaClock(each.decided_at))}</span>
              </div>
              <p className={styles.evidence}>
                {each.visit_date === null ? copy.undated : copy.visit(shortDate(each.visit_date))}
              </p>
            </li>
          ))}
        </ul>
      )}
      {more && (
        <InlineMessage tone="note" className={styles.first}>
          {firstShown(cases.length)}
        </InlineMessage>
      )}
    </Panel>
  );
}

export function NoShowsScreen() {
  // Each ruling reads the day's money and today's rulings again, so neither stands as it was before it.
  const [rulings, setRulings] = useState(0);
  const ruled = useCallback(() => {
    setRulings((count) => count + 1);
  }, []);
  return (
    <>
      <div className={styles.column}>
        <Money key={`money-${String(rulings)}`} />
        <Disputes onRuled={ruled} />
        <NoShowQueue onDecided={ruled} />
        <DecidedToday key={`decided-${String(rulings)}`} />
      </div>
    </>
  );
}
