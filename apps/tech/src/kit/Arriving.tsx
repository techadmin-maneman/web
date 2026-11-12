// The top-ups on their way to the kit (docs/decisions/0164-the-kit-screen.md; docs/prompts/tech-redesign.md, "Kit"):
// a consumable received once in hand; a hair system's pieces scanned one by one, received once the last is in, or
// with the rest reported missing, or still to come (docs/decisions/0258-the-technician-design-pass.md).

import { TAB_ICONS } from "@maneman/brand/icons";
import { amountOf } from "@maneman/web-kit/figures";
import { indiaDate } from "@maneman/web-kit/dates";
import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { Icon } from "@maneman/ui/Icon";
import { ProgressLine } from "@maneman/ui/Progress";
import { QrCamera } from "@maneman/ui/ScanField";
import { scanned as labelOf } from "@maneman/ui/scanned";
import { SectionHead } from "@maneman/ui/SectionHead";
import { TextButton } from "@maneman/ui/TextLink";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { api, type Kit } from "../api.ts";
import { kit as copy, steps } from "../content.ts";
import { dayMonth } from "../lib/when.ts";
import { NotDone, type Problem } from "./NotDone.tsx";
import styles from "./kit.module.css";
import { sayKnown, theirs } from "../lang/index.ts";

type Coming = Kit["coming"][number];

/** A hair system's name split where its details begin: "Mane Man Essential", "8 × 10 in · #1B · 20% grey". */
function nameParts(name: string): readonly [string, string | null] {
  const at = name.indexOf(" · ");
  return at === -1 ? [name, null] : [name.slice(0, at), name.slice(at + " · ".length)];
}

/** What the scan button says: that it needs signal, that it stops the camera, or that it opens it. */
function scanLabel(offline: boolean, scanning: boolean): string {
  if (offline) return copy.needsSignal;
  return scanning ? copy.scan.stop : copy.scan.camera;
}

/**
 * A receive that did not go through: what to say; or, where the top-up was settled already (received or sent back
 * elsewhere), the kit read again so it leaves the list, and Kit says why it went.
 */
async function refused(
  answer: { readonly status: number; readonly requestId: string | null },
  say: (problem: Problem) => void,
  onSettled: (kit: Kit) => void,
): Promise<void> {
  if (answer.status !== 409) {
    say({ words: copy.notDone, requestId: answer.requestId });
    return;
  }
  const fresh = await api.kit();
  if (fresh.ok) onSettled(fresh.body);
  else say({ words: copy.coming.settled, requestId: answer.requestId });
}

/** The day a top-up was sent, as the kit says it. */
const sentOn = (topUp: Coming): string => dayMonth(indiaDate(topUp.sent_at));

/** The back camera reading labels one after another; and, for a label it can't read, a box to type it in. */
function Scanner({ onScan }: { readonly onScan: (label: string) => void }) {
  // Each label read opens the camera afresh for the next.
  const [round, setRound] = useState(0);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const add = () => {
    if (labelOf(typed) === "") return;
    onScan(labelOf(typed));
    setTyped("");
  };
  return (
    <div className={styles.scanner}>
      <QrCamera
        key={round}
        words={steps.piece.camera}
        onRead={(text) => {
          onScan(labelOf(text));
          setRound(round + 1);
        }}
      />
      {typing ? (
        <div className={styles.typed}>
          <Field label={copy.scan.label}>
            {(control) => (
              <TextInput
                {...control}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  add();
                }}
              />
            )}
          </Field>
          <Button variant="outline" size="small" disabled={labelOf(typed) === ""} onClick={add}>
            {copy.scan.add}
          </Button>
        </div>
      ) : (
        <TextButton
          onClick={() => {
            setTyping(true);
          }}
        >
          {copy.scan.type}
        </TextButton>
      )}
    </div>
  );
}

/** A hair system's two actions: Scan, or Receive once every piece is in; and Report missing for the rest. */
function PieceActions(props: {
  readonly allIn: boolean;
  readonly offline: boolean;
  readonly busy: boolean;
  readonly scanning: boolean;
  readonly canReportMissing: boolean;
  readonly onScan: () => void;
  readonly onReceive: () => void;
  readonly onMissing: () => void;
}) {
  const { offline, busy } = props;
  return (
    <div className={styles.buttons}>
      {props.allIn ? (
        <Button
          variant="primary"
          size="action"
          className={styles.grow}
          busy={busy}
          disabled={offline}
          onClick={props.onReceive}
        >
          {offline ? copy.needsSignal : copy.coming.receive}
        </Button>
      ) : (
        <Button
          variant="primary"
          size="action"
          className={styles.grow}
          aria-pressed={props.scanning}
          disabled={offline || busy}
          onClick={props.onScan}
        >
          {!offline && !props.scanning && <Icon d={TAB_ICONS.photos} size="md" />}
          <span>{scanLabel(offline, props.scanning)}</span>
        </Button>
      )}
      <Button
        variant="outline"
        size="action"
        className={styles.grow}
        busy={busy}
        disabled={offline || !props.canReportMissing}
        onClick={props.onMissing}
      >
        {copy.coming.reportMissing}
      </Button>
    </div>
  );
}

/** A hair system on its way, its pieces scanned in: received once the last is, or with the rest missing or to come. */
function Pieces(props: {
  readonly topUp: Coming;
  readonly dated: boolean;
  readonly offline: boolean;
  readonly onKit: (kit: Kit) => void;
  /** A top-up settled elsewhere: the kit read again, which Kit says. */
  readonly onSettled: (kit: Kit) => void;
}) {
  const { topUp, offline } = props;
  const [taken, setScanned] = useState<readonly string[]>([]);
  // Only the pieces still on this top-up: one received with the rest to come is no longer on it.
  const scanned = taken.filter((label) => topUp.units.includes(label));
  const [scanning, setScanning] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, once] = useOneAtATime();
  const [product, details] = nameParts(topUp.name);
  const unscanned = topUp.units.length - scanned.length;
  const receive = (labels: readonly string[], rest: "on_its_way" | "missing") =>
    once(async () => {
      const answer = await api.receiveTopUp(topUp.id, labels, rest);
      if (answer.ok) props.onKit(answer.body);
      else await refused(answer, setProblem, props.onSettled);
    });
  // Every piece scanned: Receive, which the last scan tried and which a failure leaves to try again.
  const allIn = topUp.units.length > 0 && unscanned === 0;
  const add = (label: string) => {
    if (!topUp.units.includes(label)) {
      setProblem({ words: copy.coming.notOnIt, requestId: null });
      return;
    }
    setProblem(null);
    if (scanned.includes(label)) return;
    const now = [...scanned, label];
    setScanned(now);
    // The last piece in: the top-up is received whole.
    if (now.length === topUp.units.length) {
      setScanning(false);
      void receive(now, "on_its_way");
    }
  };
  return (
    <li className={styles.item}>
      <p className={styles.name}>{copy.coming.line(theirs(sayKnown(product)), amountOf(topUp.quantity, topUp.unit))}</p>
      {details !== null && <p className={styles.note}>{details}</p>}
      {props.dated && <p className={styles.note}>{copy.coming.sent(sentOn(topUp))}</p>}
      <div className={styles.progress}>
        <ProgressLine className={styles.track} value={scanned.length / topUp.units.length} />
        <span className={styles.count}>{copy.coming.scanned(scanned.length, topUp.units.length)}</span>
      </div>
      {scanning && !offline && <Scanner onScan={add} />}
      <NotDone problem={problem} />
      <PieceActions
        allIn={allIn}
        offline={offline}
        busy={busy}
        scanning={scanning}
        canReportMissing={scanned.length > 0 && unscanned > 0}
        onScan={() => {
          setScanning(!scanning);
        }}
        onReceive={() => void receive(scanned, "on_its_way")}
        onMissing={() => void receive(scanned, "missing")}
      />
      {scanned.length > 0 && unscanned > 0 && !offline && (
        <TextButton className={styles.rest} disabled={busy} onClick={() => void receive(scanned, "on_its_way")}>
          {copy.coming.restToCome(scanned.length)}
        </TextButton>
      )}
    </li>
  );
}

/** A consumable on its way: received whole, once in hand. */
function Stock(props: {
  readonly topUp: Coming;
  readonly dated: boolean;
  readonly offline: boolean;
  readonly onKit: (kit: Kit) => void;
  /** A top-up settled elsewhere: the kit read again, which Kit says. */
  readonly onSettled: (kit: Kit) => void;
}) {
  const { topUp, offline } = props;
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, once] = useOneAtATime();
  const receive = () =>
    once(async () => {
      const answer = await api.receiveTopUp(topUp.id, null, "on_its_way");
      if (answer.ok) props.onKit(answer.body);
      else await refused(answer, setProblem, props.onSettled);
    });
  return (
    <li className={styles.item}>
      <div className={styles.stock}>
        <div>
          <p className={styles.name}>
            {copy.coming.line(theirs(sayKnown(topUp.name)), amountOf(topUp.quantity, topUp.unit))}
          </p>
          {props.dated && <p className={styles.note}>{copy.coming.sent(sentOn(topUp))}</p>}
        </div>
        <Button variant="outline" size="small" busy={busy} disabled={offline} onClick={() => void receive()}>
          {offline ? copy.needsSignal : copy.coming.receive}
        </Button>
      </div>
      <NotDone problem={problem} />
    </li>
  );
}

export function Arriving(props: {
  readonly kit: Kit;
  readonly offline: boolean;
  readonly onKit: (kit: Kit) => void;
  readonly onSettled: (kit: Kit) => void;
}) {
  const { coming } = props.kit;
  const [first] = coming;
  if (first === undefined) return null;
  // Sent the same day, the day is said once, by the head; otherwise beside each.
  const oneDay = coming.every((topUp) => sentOn(topUp) === sentOn(first));
  return (
    <section className={styles.section} aria-labelledby="kit-coming">
      <SectionHead
        id="kit-coming"
        size="list"
        title={copy.coming.title}
        end={oneDay ? copy.coming.sent(sentOn(first)) : undefined}
      />
      <ul className={styles.list}>
        {coming.map((topUp) =>
          topUp.units.length > 0 ? (
            <Pieces
              key={topUp.id}
              topUp={topUp}
              dated={!oneDay}
              offline={props.offline}
              onKit={props.onKit}
              onSettled={props.onSettled}
            />
          ) : (
            <Stock
              key={topUp.id}
              topUp={topUp}
              dated={!oneDay}
              offline={props.offline}
              onKit={props.onKit}
              onSettled={props.onSettled}
            />
          ),
        )}
      </ul>
    </section>
  );
}
