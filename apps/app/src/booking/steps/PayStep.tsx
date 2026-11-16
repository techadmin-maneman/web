// The review, as the design draws it: the time held, what is booked and where, what it costs, what changing it later
// costs, and what the booking agrees to, over Pay. A payment that failed is said at its head, and Pay tries again.

import { CLIENT_ICONS } from "@maneman/brand/icons";
import { classes } from "@maneman/ui/classes";
import { Checkbox } from "@maneman/ui/Field";
import { Icon } from "@maneman/ui/Icon";
import { NoticeLine } from "@maneman/ui/NoticeLine";
import { ProgressLine } from "@maneman/ui/Progress";
import { TextButton, TextLink } from "@maneman/ui/TextLink";
import { CLIENT_WORDS } from "@maneman/web-kit/client-words";
import { apiNow } from "@maneman/web-kit/clock";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Address, Hold, MoveTerms } from "../../api.ts";
import { ActionWithMissing } from "../../frame/ActionWithMissing.tsx";
import { arrivalHours, booking, change, LEGAL_URLS, missing, ONE_VISIT } from "../../content.ts";
import { priceFigures } from "../../lib/money.ts";
import { noticeUrl } from "../../lib/notices.ts";
import { CodeBox } from "../CodeBox.tsx";
import { photoLine } from "../consents.ts";
import { atStake, insideNotice, type AtStake } from "../late-change.ts";
import { paysNothing } from "../pay.ts";
import styles from "../booking.module.css";
import { Frame, LastMinute, LateFee, minutesAndSeconds, useHoldLeft, type StepAt } from "./shared.tsx";

/** What the review names: the service booked, or, for a move, the visit moved or its late fee. */
function itemName(hold: Hold, moving: MoveTerms | undefined): string {
  const what = hold.one_visit ? ONE_VISIT : hold.service.name;
  if (moving?.cost === "free") return change.moveItem(what);
  if (moving?.cost === "late_fee") return change.lateFeeItem(what);
  return what;
}

/** What Pay says: what is paid, or, with nothing to pay, what is confirmed. */
function payLabel(hold: Hold, moving: MoveTerms | undefined): string {
  if (!paysNothing(hold)) return booking.pay.pay(rupees(hold.price.amount));
  return moving === undefined ? booking.pay.confirm : change.confirmMove;
}

/** The review's figure: nothing for a visit a credit covers, "Free" for one that costs nothing, else its price. */
function amountLine(hold: Hold, covered: boolean, free: boolean): string {
  if (covered) return booking.pay.credit.zero;
  return free ? booking.pay.free : rupees(hold.price.amount);
}

/** What a visit moved in place keeps: its payment or its credit. Nothing to say for one that held neither. */
function carriedOver(moving: MoveTerms): string | null {
  if (moving.credit !== null) return change.move.creditCarriesOver;
  return moving.paid > 0 ? change.move.carriesOver(rupees(moving.paid)) : null;
}

/** What a change inside the notice takes, where it takes anything. */
type Charged = Exclude<AtStake, { readonly kind: "nothing" }>;

/** "This visit is less than 24 hours away: moving or cancelling it costs Rs. 1,180 (Rs. 1,000 + Rs. 180 GST)." */
function InsideNotice({ stake, hours }: { stake: Charged; hours: number }) {
  const copy = booking.pay.insideNotice;
  if (stake.kind === "credit") return copy.credit(hours);
  if (stake.kind === "payment") return copy.payment(hours, rupees(stake.paid));
  const { amount, split } = priceFigures(stake.fee);
  return (
    <>
      {copy.lateFee(hours, amount)}
      {split !== null && <span className={styles.inclusive}>{booking.lateFee.split(split)}</span>}.
    </>
  );
}

/** "Free to move or cancel until 9 am, Fri 2 Oct.", and what a change costs after that. */
function FreeUntil({ hold, stake }: { hold: Hold; stake: Charged }) {
  const copy = booking.pay;
  const when = copy.freeUntil(`${indiaClock(hold.free_until)}, ${shortDate(indiaDate(hold.free_until))}`);
  if (stake.kind === "late_fee") {
    return (
      <>
        {`${when} `}
        <LateFee fee={stake.fee} noticeHours={hold.change_notice_hours} />
      </>
    );
  }
  // A credit's own note, beneath Pay, says what a late cancel costs.
  if (stake.kind === "credit") return when;
  return `${when}${copy.afterThat}`;
}

/**
 * What changing the visit later costs, as the booking is sold: free at any time; free until a time, and its cost
 * after; or, for a visit already inside the notice, what a change costs from now.
 */
function LaterChanges({ hold, stake, late }: { hold: Hold; stake: AtStake; late: boolean }) {
  if (stake.kind === "nothing") return booking.pay.freeAnyTime;
  if (late) return <InsideNotice stake={stake} hours={hold.change_notice_hours} />;
  return <FreeUntil hold={hold} stake={stake} />;
}

/** "Now", the time a change starts to cost, and the visit, on a line: drawn alone, the words beneath say it. */
function ChangeLine({ hold }: { hold: Hold }) {
  const copy = booking.pay;
  return (
    <div className={styles.changeLine} aria-hidden="true">
      <ProgressLine className={styles.changeTrack} value={0.75} />
      <span>{copy.now}</span>
      <span
        className={styles.changeFrom}
      >{`${shortDate(indiaDate(hold.free_until))}, ${indiaClock(hold.free_until)}`}</span>
      <span>{copy.theVisit}</span>
    </div>
  );
}

/**
 * Changing your plans: what a visit moved in place keeps, where the review's facts have not said it, then, on a line,
 * until when a change is free, and what it costs. `late`: the visit is already inside its notice.
 */
function ChangingPlans(props: { hold: Hold; moving: MoveTerms | undefined; stake: AtStake; late: boolean }) {
  // A move that costs nothing says what it keeps among the facts, as its payment.
  const kept = props.moving === undefined || paysNothing(props.hold) ? null : carriedOver(props.moving);
  return (
    <section className={styles.changing}>
      <h3 className={styles.changingTitle}>{booking.pay.changing}</h3>
      {props.stake.kind !== "nothing" && !props.late && <ChangeLine hold={props.hold} />}
      {kept !== null && <p className={styles.changingLine}>{kept}</p>}
      <p className={styles.changingLine}>
        <LaterChanges hold={props.hold} stake={props.stake} late={props.late} />
      </p>
    </section>
  );
}

/** The reminder box's words: a yes to WhatsApp about the visit, with its link to the notice. */
function RemindLine() {
  return (
    <NoticeLine
      line={{ says: booking.pay.remind, link: null }}
      href={noticeUrl("whatsapp")}
      more={CLIENT_WORDS.noticeMore}
    />
  );
}

/** "I agree to the Terms and Conditions and the Privacy Policy.", each a link to the site's page, in a new tab. */
function AgreeLine() {
  const words = booking.pay.agree;
  const urls = LEGAL_URLS[import.meta.env.MM_ENV];
  return (
    <span>
      {words.before}
      <TextLink inline newTab href={urls.terms}>
        {words.terms}
      </TextLink>
      {words.between}
      <TextLink inline newTab href={urls.privacy}>
        {words.privacy}
      </TextLink>
      {words.after}
    </span>
  );
}

/** The review's ticks: the day-before reminder, where it is not on already, and a new booking's agreement. */
function Agreements(props: {
  askToRemind: boolean;
  remind: boolean;
  onRemind: (remind: boolean) => void;
  asksAgreement: boolean;
  agreed: boolean;
  onAgree: (agreed: boolean) => void;
}) {
  return (
    <>
      {props.askToRemind && (
        <Checkbox
          className={styles.remind}
          label={<RemindLine />}
          checked={props.remind}
          onChange={(event) => {
            props.onRemind(event.target.checked);
          }}
        />
      )}
      {props.asksAgreement && (
        <Checkbox
          className={styles.remind}
          label={<AgreeLine />}
          checked={props.agreed}
          onChange={(event) => {
            props.onAgree(event.target.checked);
          }}
        />
      )}
    </>
  );
}

/** What every visit's photographs are, in one quiet line, with its link to the notice. */
function VisitPhotos() {
  return (
    <p className={styles.consents}>
      <NoticeLine line={{ says: photoLine(), link: null }} href={noticeUrl("photos")} more={CLIENT_WORDS.noticeMore} />
    </p>
  );
}

/** A name beside its value, as the design's review lists them, between hairlines. */
function Fact({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * What the visit costs, as the review's last facts: for a move in place that keeps what was paid, what it keeps; for
 * a visit a free service visit covers, the credit used and its price struck through; otherwise the total.
 */
function PriceFacts({ hold, moving }: { hold: Hold; moving: MoveTerms | undefined }) {
  const copy = booking.pay;
  const covered = hold.credit !== null;
  const free = paysNothing(hold);
  const listPrice = hold.discount?.list_price ?? null;
  const { split } = priceFigures(hold.price);
  const kept = moving === undefined ? null : carriedOver(moving);
  return (
    <>
      {hold.credit !== null && <Fact name={copy.credit.used}>{copy.credit.remaining(hold.credit.remaining)}</Fact>}
      {kept !== null && free ? (
        <Fact name={copy.payment}>{kept}</Fact>
      ) : (
        <Fact name={split === null || free ? copy.total : copy.totalWithGst}>
          {covered && <s className={styles.was}>{rupees(hold.price.amount)}</s>}
          {listPrice !== null && <s className={styles.was}>{rupees(listPrice.amount)}</s>}
          <strong className={styles.amount}>{amountLine(hold, covered, free)}</strong>
          {!free && split !== null && <span className={styles.factNote}>{split}</span>}
        </Fact>
      )}
    </>
  );
}

/** The facts of what is held: the visit, when, who comes, where, and what it costs. */
function HeldFacts(props: {
  hold: Hold;
  moving: MoveTerms | undefined;
  address: Address | null;
  onChangeAddress: () => void;
}) {
  const { hold } = props;
  const copy = booking.pay;
  return (
    <dl className={styles.facts}>
      <Fact name={copy.visit}>
        <span>{itemName(hold, props.moving)}</span>
        {/* A first fit takes the morning: how long, as its service says. */}
        {hold.type === "first_fit" && props.moving === undefined && (
          <span className={styles.factNote}>{booking.length(hold.service.minutes)}</span>
        )}
      </Fact>
      <Fact name={copy.when}>{booking.when.summary(shortDate(hold.date), arrivalHours(hold))}</Fact>
      <Fact name={copy.technician}>{copy.assigned}</Fact>
      {props.address !== null && (
        <Fact name={copy.address}>
          {props.address.line1}
          {/* A move keeps its visit's address: only a new booking changes it here. */}
          {props.moving === undefined && (
            <TextButton tone="plain" className={styles.factAction} onClick={props.onChangeAddress}>
              {copy.changeAddress}
            </TextButton>
          )}
        </Fact>
      )}
      <PriceFacts hold={hold} moving={props.moving} />
    </dl>
  );
}

/** The time held, counting down; said once, a minute before it lapses. */
function HoldLine({ left }: { left: number }) {
  return (
    <>
      <p className={styles.holding}>
        <Icon d={CLIENT_ICONS.lock} size="sm" />
        <span>
          {booking.pay.holding}
          <b>{minutesAndSeconds(left)}</b>
        </span>
      </p>
      <LastMinute left={left} />
    </>
  );
}

/**
 * The payment that failed, at the review's head: nothing was booked, and Pay tries again. Brought into view, since Pay
 * was tapped at the foot of a review scrolled down to its ticks.
 */
function PaymentFailed() {
  const notice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    notice.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <div ref={notice} className={classes(styles.notice, styles.noticeError)} role="alert">
      <Icon className={styles.noticeIcon} d={CLIENT_ICONS.alert} size="md" />
      <p>
        <strong className={styles.noticeTitle}>{booking.failed.title}</strong>
        {` ${booking.failed.line}`}
      </p>
    </div>
  );
}

/** Pay, with what went wrong starting it, and a credit's late-cancel note beneath. */
function PayFooter(props: {
  hold: Hold;
  moving: MoveTerms | undefined;
  busy: boolean;
  problem: string | null;
  held: boolean;
  missing: string | null;
  creditNote: boolean;
  onPay: () => void;
}) {
  return (
    <>
      {props.problem !== null && (
        <p className={styles.problem} role="alert">
          {props.problem}
        </p>
      )}
      <ActionWithMissing
        id="agree-terms"
        className={styles.primary}
        busy={props.busy}
        held={props.held}
        missing={props.missing}
        onClick={props.onPay}
      >
        {payLabel(props.hold, props.moving)}
      </ActionWithMissing>
      {props.creditNote && (
        <p className={styles.creditNote}>{booking.pay.credit.note(props.hold.change_notice_hours)}</p>
      )}
    </>
  );
}

/** The review's way through: back, out, the address changed, the hold priced again, and Pay. */
interface ReviewActions {
  readonly onPay: () => void;
  /** The hold priced again, once a discount code is applied or removed. */
  readonly onHold: (hold: Hold) => void;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly onChangeAddress: () => void;
}

/** The review: the held visit, what it costs, what changing it later costs, and Pay. */
export function PayStep(
  props: ReviewActions & {
    hold: Hold;
    moving?: MoveTerms | undefined;
    /** The address the visit is at, from the profile; null where it could not be read. */
    address: Address | null;
    /** The last payment failed: said at the head, and Pay tries again. */
    failed: boolean;
    step: StepAt;
    busy: boolean;
    problem: string | null;
    /** Whether to ask to remind the client the day before: not when they have already switched it on. */
    askToRemind: boolean;
    remind: boolean;
    onRemind: (remind: boolean) => void;
  },
) {
  const { hold, moving } = props;
  const left = useHoldLeft(hold);
  // A move in place keeps the visit as it was booked: only its new time, and what the move costs, are shown.
  const inPlace = moving !== undefined && moving.cost !== "charged";
  const stake = atStake(hold, inPlace ? moving : undefined);
  // Read on every tick of the hold's count, so a visit that passes into its notice while the client decides says so.
  const late = insideNotice(hold, apiNow());
  // A code is for a visit sold, never a move, nor one a credit pays for, nor a consultation, which costs nothing.
  const takesACode = moving === undefined && hold.credit === null && hold.type !== "consultation";
  // A code being applied or taken off may change the price: Pay waits for it, so the order is for the price shown.
  const [codeSending, setCodeSending] = useState(false);
  // A new booking agrees to the terms by a tick of the client's own; a move keeps the booking it moves.
  const asksAgreement = moving === undefined;
  const [agreed, setAgreed] = useState(false);
  return (
    <Frame
      title={booking.pay.title}
      step={props.step}
      onBack={props.onBack}
      onClose={props.onClose}
      footer={
        <PayFooter
          hold={hold}
          moving={moving}
          busy={props.busy}
          problem={props.problem}
          held={codeSending || left === 0}
          missing={asksAgreement && !agreed ? missing.agreeTerms : null}
          creditNote={stake.kind === "credit" && !late}
          onPay={props.onPay}
        />
      }
    >
      <HoldLine left={left} />
      {props.failed && <PaymentFailed />}
      <HeldFacts
        hold={hold}
        moving={inPlace ? moving : undefined}
        address={props.address}
        onChangeAddress={props.onChangeAddress}
      />
      {hold.type === "first_fit" && !inPlace && <p className={styles.line}>{booking.pay.guarantee}</p>}
      {!paysNothing(hold) && (
        <p className={styles.razorpay}>
          <Icon d={CLIENT_ICONS.lock} size="sm" />
          <span>{booking.pay.razorpay}</span>
        </p>
      )}
      {takesACode && <CodeBox hold={hold} busy={props.busy} onHold={props.onHold} onSending={setCodeSending} />}
      <ChangingPlans hold={hold} moving={inPlace ? moving : undefined} stake={stake} late={late} />
      <Agreements
        askToRemind={props.askToRemind}
        remind={props.remind}
        onRemind={props.onRemind}
        asksAgreement={asksAgreement}
        agreed={agreed}
        onAgree={setAgreed}
      />
      <VisitPhotos />
    </Frame>
  );
}
