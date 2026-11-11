// Kit (docs/decisions/0164-the-kit-screen.md; docs/prompts/tech-redesign.md, "Kit"), in the new look: the next seven
// days' consumables against what the kit holds; what is on its way to it, received once in hand; what goes back to
// ops, the pieces that came off clients and any expired stock; and what it holds, each lot's expiry beside it, low and
// out in colour. Never a cost. Its writes need signal, and say so without it.

import { amountOf } from "@maneman/web-kit/figures";
import { fullDate, indiaDate } from "@maneman/web-kit/dates";
import { Button } from "@maneman/ui/Button";
import { SectionHead } from "@maneman/ui/SectionHead";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { api, type Kit } from "../api.ts";
import { NoSignal } from "../frame/Banners.tsx";
import { ReachOps } from "../frame/ReachOps.tsx";
import { Failed, Loading } from "../frame/States.tsx";
import { SyncLabel } from "../frame/SyncLabel.tsx";
import { kit as copy } from "../content.ts";
import { useScreen } from "../lib/useScreen.ts";
import { dayMonth } from "../lib/when.ts";
import { useSession } from "../session.ts";
import { Arriving } from "./Arriving.tsx";
import { Forecast } from "./Forecast.tsx";
import { NotDone, type Problem } from "./NotDone.tsx";
import styles from "./kit.module.css";

type Held = Kit["held"][number];

/** What the kit holds of an item: its count, or that it is out, and how far short where more was used than it held. */
function heldOf(quantity: number, unit: string): string {
  if (quantity > 0) return amountOf(quantity, unit);
  return copy.held.out(quantity === 0 ? null : amountOf(-quantity, unit));
}

/** A lot's expiry as the kit says it: to use first, or when. */
const lotWhen = (lot: { readonly use_first: boolean }, on: string): string =>
  lot.use_first ? copy.held.useFirst(on) : copy.held.expires(on);

/** The lines beneath an item the kit holds: low, its labelled pieces, and each lot not yet expired with its expiry. */
function heldLines(item: Held, today: string, coming: boolean): string[] {
  const lots = item.lots
    .filter((lot) => !lot.recalled && lot.expires_on !== null && lot.expires_on >= today)
    .map(
      (lot) =>
        `${lot.lot_code} · ${amountOf(lot.quantity, item.unit)} · ${lotWhen(lot, fullDate(lot.expires_on ?? today))}`,
    );
  return [
    ...(item.low && item.usable > 0 ? [lowLine(item, coming)] : []),
    ...(item.hair_system ? [copy.held.pieces(item.units.length)] : []),
    ...lots,
  ];
}

/** Why an item is low: ops told, or more on its way; or low only for stock to hand back, which tells ops once back. */
function lowLine(item: Held, coming: boolean): string {
  if (coming) return copy.held.low(true);
  return item.ops_told ? copy.held.low(false) : copy.held.lowUntilBack;
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
      <SectionHead id="kit-held" title={copy.held.title} />
      {kit.held.length === 0 ? (
        <p className={styles.note}>{copy.held.none}</p>
      ) : (
        <ul className={styles.rows}>
          {kit.held.map((item) => (
            <li key={item.code} className={styles.row}>
              <div>
                <p className={styles.name}>{item.name}</p>
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
      <SectionHead id="kit-returned" title={copy.returned.title} />
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
                {item.name} {lot.lot_code} · {amountOf(lot.quantity, item.unit)}
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
  const kit = after ?? (loaded.state === "loaded" ? loaded.value : null);
  return (
    <main className={styles.screen} data-look="light">
      <header className={styles.head}>
        <h1 className={styles.title} ref={heading} tabIndex={-1}>
          {copy.title}
        </h1>
        <SyncLabel />
      </header>
      {offline && <NoSignal />}
      {kit === null && loaded.state === "loading" && <Loading onPaper />}
      {kit === null && loaded.state === "failed" && (
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={loaded.requestId} onPaper />
      )}
      {kit !== null && (
        <>
          <Forecast kit={kit} offline={offline} onKit={setAfter} />
          <Arriving kit={kit} offline={offline} onKit={setAfter} />
          <ReturnToOps kit={kit} offline={offline} onKit={setAfter} />
          <InKit kit={kit} />
        </>
      )}
      <ReachOps className={styles.reach} onPaper />
    </main>
  );
}
