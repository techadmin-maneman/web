// The kit's next seven days (docs/prompts/tech-redesign.md, "Kit"): each consumable the visits booked from today on
// are expected to use, against what the kit holds, and how far short it falls, in red.

import { Button } from "@maneman/ui/Button";
import { SectionHead } from "@maneman/ui/SectionHead";
import { Table } from "@maneman/ui/Table";
import { amountOf, isMeasure } from "@maneman/web-kit/figures";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { api, type Kit } from "../api.ts";
import { kit as kitCopy } from "../content.ts";
import { stamp } from "../lib/when.ts";
import { NotDone, type Problem } from "./NotDone.tsx";
import styles from "./kit.module.css";
import { sayKnown, theirs } from "../lang/index.ts";

const copy = kitCopy.forecast;

type Need = Kit["forecast"][number];

/** How far short of an item the kit is. */
const shortOf = (item: { readonly need: number; readonly have: number }): number => item.need - Math.max(item.have, 0);

/** An item's name in the forecast: a measure after it, as "Solvent, ml"; a thing counted by its name alone. */
const named = (item: Need): string =>
  isMeasure(item.unit) ? `${sayKnown(item.name)}, ${item.unit}` : sayKnown(item.name);

/**
 * The one thing short, as the ask names it: "6 Shampoo sachets", "4 Tape strips", "90 ml of Solvent". Ops' name for
 * it is kept as they wrote it, made plural where a count is.
 */
function shortPhrase(item: Need): string {
  const count = shortOf(item);
  const name = item.name;
  const words = name.toLowerCase();
  if (isMeasure(item.unit)) return `${amountOf(count, item.unit)} of ${name}`;
  // A unit ops wrote in the plural counts as its one.
  const unit = item.unit.replace(/s$/, "");
  if (!words.endsWith(unit) && !words.endsWith(`${unit}s`)) return `${amountOf(count, unit)} of ${name}`;
  if (count === 1) return `1 ${name.replace(/s$/, "")}`;
  return `${String(count)} ${words.endsWith("s") ? name : `${name}s`}`;
}

/** What the ask says: the one thing short, named; or what's short, where it is more than one. */
function askLabel(forecast: readonly Need[]): string {
  const short = forecast.filter((item) => shortOf(item) > 0);
  const [only] = short;
  return short.length === 1 && only !== undefined ? copy.requestOne(theirs(shortPhrase(only))) : copy.request;
}

/** The one tap that asks ops for what is short, straight with signal; or, once asked, when, until ops settle it. */
function Request(props: { readonly kit: Kit; readonly offline: boolean; readonly onKit: (kit: Kit) => void }) {
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, once] = useOneAtATime();
  if (props.kit.asked !== null) {
    return (
      <p className={styles.note} role="status">
        {copy.requested(stamp(props.kit.asked.asked_at))}
      </p>
    );
  }
  if (!props.kit.forecast.some((item) => shortOf(item) > 0)) {
    return problem === null ? null : <NotDone problem={problem} />;
  }
  const ask = () =>
    once(async () => {
      const answer = await api.kitRequest();
      if (answer.ok) {
        setProblem(null);
        props.onKit(answer.body);
        return;
      }
      // Short of nothing now: the forecast is read again, and says so.
      if (answer.status === 409) {
        setProblem({ words: copy.nothingShort, requestId: null });
        const fresh = await api.kit();
        if (fresh.ok) props.onKit(fresh.body);
        return;
      }
      setProblem({ words: copy.requestFailed, requestId: answer.requestId });
    });
  return (
    <div className={styles.buttons}>
      <NotDone problem={problem} />
      <Button variant="primary" size="action" busy={busy} disabled={props.offline} onClick={() => void ask()}>
        {props.offline ? kitCopy.needsSignal : askLabel(props.kit.forecast)}
      </Button>
    </div>
  );
}

/** One line of the forecast: the item, what the week needs, what the kit has, and whether that is enough. */
function Line(props: { readonly name: string; readonly need: number; readonly have: number }) {
  const short = shortOf(props);
  return (
    <tr>
      <th scope="row">{props.name}</th>
      <td>{props.need}</td>
      <td>{props.have}</td>
      <td className={short > 0 ? styles.short : styles.enough}>{short > 0 ? copy.short(short) : copy.enough}</td>
    </tr>
  );
}

export function Forecast(props: { readonly kit: Kit; readonly offline: boolean; readonly onKit: (kit: Kit) => void }) {
  const { forecast, pieces } = props.kit;
  return (
    <section className={styles.section} aria-labelledby="kit-forecast">
      <SectionHead id="kit-forecast" size="list" title={copy.title} end={copy.bookings(props.kit.visits)} />
      {forecast.length === 0 && pieces.length === 0 ? (
        <p className={styles.note}>{copy.none}</p>
      ) : (
        <Table plain className={styles.forecast}>
          <thead>
            <tr>
              <th scope="col">{copy.item}</th>
              <th scope="col">{copy.need}</th>
              <th scope="col">{copy.have}</th>
              <th scope="col">{copy.status}</th>
            </tr>
          </thead>
          <tbody>
            {forecast.map((item) => (
              <Line key={item.code} name={named(item)} need={item.need} have={item.have} />
            ))}
            {pieces.map((item) => (
              <Line
                key={`piece:${item.product}`}
                name={copy.pieces(theirs(sayKnown(item.name)))}
                need={item.need}
                have={item.have}
              />
            ))}
          </tbody>
        </Table>
      )}
      <Request kit={props.kit} offline={props.offline} onKit={props.onKit} />
    </section>
  );
}
