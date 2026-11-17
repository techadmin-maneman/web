// Kit (docs/decisions/0164-the-kit-screen.md; docs/prompts/tech-redesign.md, "Kit"), in the new look: the next seven
// days' consumables against what the kit holds; what is on its way to it, received once in hand; what goes back to
// ops, the pieces that came off clients and any expired stock; and what it holds, each lot's expiry beside it, low and
// out in colour. Never a cost. Its writes need signal, and say so without it.

import { amountOf, isMeasure } from "@maneman/web-kit/figures";
import { fullDate, indiaDate, listDate } from "@maneman/web-kit/dates";
import { Button } from "@maneman/ui/Button";
import { SectionHead } from "@maneman/ui/SectionHead";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useEffect, useState } from "react";
import { api, type Kit } from "../api.ts";
import { ReachOps } from "../frame/ReachOps.tsx";
import { Failed, Loading } from "../frame/States.tsx";
import { SyncLabel } from "../frame/SyncLabel.tsx";
import { kit as copy } from "../content.ts";
import { useScreen } from "../lib/useScreen.ts";
import { apiDate, clock, dayMonth } from "../lib/when.ts";
import { useSession } from "../session.ts";
import { Arriving } from "./Arriving.tsx";
import { Forecast } from "./Forecast.tsx";
import { NotDone, type Problem } from "./NotDone.tsx";
import styles from "./kit.module.css";
import { sayKnown, sayNow } from "../lang/index.ts";

type Held = Kit["held"][number];

/** What the kit holds of an item fit to use, bare as the prototype draws it: "46", "100 ml"; out, nought. */
function heldOf(quantity: number, unit: string): string {
  const left = Math.max(quantity, 0);
  return isMeasure(unit) ? sayNow(amountOf(left, unit)) : String(left);
}

/**
 * A lot not yet expired, as the prototype writes it: its code and expiry, or to use it first. Where the item is in more
 * than one lot, each says how much it holds.
 */
function lotLine(lot: Held["lots"][number], item: Held, today: string, several: boolean): string {
  // This year's by its day, "24 Nov"; one further off with its year, "31 May 2027".
  const on = listDate(lot.expires_on ?? today, Number(today.slice(0, 4)));
  if (lot.use_first) return copy.held.useFirst(lot.lot_code, on);
  const code = several ? `${lot.lot_code} · ${sayNow(amountOf(lot.quantity, item.unit))}` : lot.lot_code;
  return copy.held.expires(code, on);
}

/** The lines beneath an item the kit holds: out or low, its labelled pieces, and each lot not yet expired. */
function heldLines(item: Held, today: string, coming: boolean): string[] {
  const lots = item.lots.filter((lot) => !lot.recalled && lot.expires_on !== null && lot.expires_on >= today);
  const short = item.usable < 0 ? amountOf(-item.usable, item.unit) : null;
  const out = item.usable <= 0;
  return [
    ...(out ? [outLine(item, short, coming)] : []),
    ...(!out && item.low ? [lowLine(item, coming)] : []),
    ...(item.hair_system ? [copy.held.pieces(item.units.length)] : []),
    ...lots.map((lot) => lotLine(lot, item, today, lots.length > 1)),
  ];
}

/** Why an item is low: ops told, or more on its way; or low only for stock to hand back, which tells ops once back. */
function lowLine(item: Held, coming: boolean): string {
  if (coming) return copy.held.low(true);
  return item.ops_told ? copy.held.low(false) : copy.held.lowUntilBack;
}

/** The same for an item out, and how far short where more was used than it held. */
function outLine(item: Held, short: string | null, coming: boolean): string {
  if (coming || item.ops_told) return copy.held.out(short, coming);
  return copy.held.outUntilBack(short);
}

/** An item's figure, what it holds fit to use: out in red, low in the metal's words, otherwise quiet. */
function amountLook(item: Held): string | undefined {
  if (item.usable <= 0) return styles.out;
  return item.low ? styles.low : styles.amount;
}

/** What the kit holds, low and out in colour. */
function InKit({ kit }: { readonly kit: Kit }) {
  const coming = new Set(kit.coming.map((topUp) => topUp.code));
  return (
    <section className={styles.section} aria-labelledby="kit-held">
      <SectionHead id="kit-held" size="list" title={copy.held.title} />
      {kit.held.length === 0 ? (
        <p className={styles.note}>{copy.held.none}</p>
      ) : (
        <ul className={styles.rows}>
          {kit.held.map((item) => (
            <li key={item.code} className={styles.row}>
              <div>
                <p className={styles.name}>{sayKnown(item.name)}</p>
                {heldLines(item, kit.today, coming.has(item.code)).map((line) => (
                  <p key={line} className={styles.note}>
                    {line}
                  </p>
                ))}
              </div>
              <p className={amountLook(item)}>{heldOf(item.usable, item.unit)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The kit's lots past their expiry or in a recall, each a line to hand back. */
const expiredLots = (kit: Kit) =>
  kit.held.flatMap((item) =>
    item.lots
      .filter((lot) => lot.recalled || (lot.expires_on !== null && lot.expires_on < kit.today))
      .map((lot) => ({ item, lot, on: fullDate(lot.expires_on ?? kit.today) })),
  );

/** The pieces that came off clients, and the kit's expired stock, handed back together or apart. */
function ReturnToOps(props: { readonly kit: Kit; readonly offline: boolean; readonly onKit: (kit: Kit) => void }) {
  const { kit, offline } = props;
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, once] = useOneAtATime();
  const expired = expiredLots(kit);
  if (kit.returned.length === 0 && expired.length === 0) {
    return done ? <p className={styles.status}>{copy.handedBack}</p> : null;
  }
  const hand = (body: { pieces: string[]; expired: boolean }) =>
    once(async () => {
      const answer = await api.handBack(body);
      if (!answer.ok) {
        setProblem({ words: copy.notDone, requestId: answer.requestId });
        return;
      }
      setProblem(null);
      setDone(true);
      props.onKit(answer.body);
    });
  return (
    <section className={styles.section} aria-labelledby="kit-returned">
      <SectionHead id="kit-returned" size="list" title={copy.returned.title} />
      <ul className={styles.rows}>
        {kit.returned.map((piece) => (
          <li key={piece.piece_code} className={styles.row}>
            <div>
              <p className={styles.name}>{piece.piece_code}</p>
              <p className={styles.note}>{copy.returned.line(dayMonth(indiaDate(piece.returned_at)))}</p>
            </div>
          </li>
        ))}
        {expired.map(({ item, lot, on }) => (
          <li key={`${item.code}/${lot.lot_code}`} className={styles.row}>
            <div>
              <p className={styles.name}>
                {sayKnown(item.name)} {lot.lot_code} · {sayNow(amountOf(lot.quantity, item.unit))}
              </p>
              <p className={styles.note}>{lot.recalled ? copy.held.recalled : copy.held.expired(on)}</p>
            </div>
            <p className={styles.out}>{lot.recalled ? copy.expired.recalledWord : copy.expired.word}</p>
          </li>
        ))}
      </ul>
      <NotDone problem={problem} />
      <div className={styles.buttons}>
        {kit.returned.length > 0 && (
          <Button
            variant="outline"
            size="action"
            busy={busy}
            disabled={offline}
            onClick={() => void hand({ pieces: kit.returned.map((piece) => piece.piece_code), expired: false })}
          >
            {offline ? copy.needsSignal : copy.returned.handBack(kit.returned.length)}
          </Button>
        )}
        {expired.length > 0 && (
          <Button
            variant="outline"
            size="action"
            busy={busy}
            disabled={offline}
            onClick={() => void hand({ pieces: [], expired: true })}
          >
            {offline ? copy.needsSignal : copy.expired.handBack}
          </Button>
        )}
      </div>
    </section>
  );
}

export function KitScreen() {
  const { offline } = useSession();
  const heading = useScreen(copy.title);
  const [loaded, retry] = useLoad(api.kit);
  const [after, setAfter] = useState<Kit | null>(null);
  // A top-up received or sent back elsewhere, which left the list as the kit was read again.
  const [settled, setSettled] = useState(false);
  // A kit write that went through: the kit as it now stands, and the line about a settled top-up no longer needed.
  const written = (fresh: Kit) => {
    setAfter(fresh);
    setSettled(false);
  };
  const kit = after ?? (loaded.state === "loaded" ? loaded.value : null);
  // When the kit was last read, so a phone without signal shows how old its figures are.
  const [readAt, setReadAt] = useState<string | null>(null);
  useEffect(() => {
    if (kit !== null) setReadAt(apiDate().toISOString());
  }, [kit]);
  return (
    <main className={styles.screen} data-look="light">
      <header className={styles.head}>
        <div>
          <h1 className={styles.title} ref={heading} tabIndex={-1}>
            {copy.title}
          </h1>
          {readAt !== null && <p className={styles.updated}>{copy.updated(clock(readAt))}</p>}
        </div>
        <SyncLabel />
      </header>
      {kit === null && loaded.state === "loading" && <Loading onPaper />}
      {kit === null && loaded.state === "failed" && (
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={loaded.requestId} onPaper />
      )}
      {kit !== null && (
        <>
          <Forecast kit={kit} offline={offline} onKit={written} />
          <Arriving
            kit={kit}
            offline={offline}
            onKit={written}
            onSettled={(fresh) => {
              setAfter(fresh);
              setSettled(true);
            }}
          />
          {settled && (
            <p className={styles.status} role="status">
              {copy.coming.settled}
            </p>
          )}
          <ReturnToOps kit={kit} offline={offline} onKit={written} />
          <InKit kit={kit} />
        </>
      )}
      {/* Only a kit with nothing in it, nothing coming and nothing to hand back asks ops (ADR 0258 decision 2). */}
      {kit !== null && kit.held.length === 0 && kit.coming.length === 0 && kit.returned.length === 0 && (
        <ReachOps className={styles.reach} onPaper />
      )}
    </main>
  );
}
