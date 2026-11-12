// The kit's next seven days (docs/prompts/tech-redesign.md, "Kit"): each consumable the visits booked from today on
// are expected to use, against what the kit holds, and how far short it falls, in red.

import { Button } from "@maneman/ui/Button";
import { SectionHead } from "@maneman/ui/SectionHead";
import { Table } from "@maneman/ui/Table";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { api, type Kit } from "../api.ts";
import { kit as kitCopy } from "../content.ts";
import { stamp } from "../lib/when.ts";
import { NotDone, type Problem } from "./NotDone.tsx";
import styles from "./kit.module.css";
import { sayKnown } from "../lang/index.ts";

const copy = kitCopy.forecast;

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
  if (!props.kit.forecast.some((item) => item.need > Math.max(item.have, 0))) {
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
        {props.offline ? kitCopy.needsSignal : copy.request}
      </Button>
    </div>
  );
}

export function Forecast(props: { readonly kit: Kit; readonly offline: boolean; readonly onKit: (kit: Kit) => void }) {
  const { forecast } = props.kit;
  return (
    <section className={styles.section} aria-labelledby="kit-forecast">
      <SectionHead id="kit-forecast" title={copy.title} />
      {forecast.length === 0 ? (
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
            {forecast.map((item) => {
              const short = item.need - Math.max(item.have, 0);
              return (
                <tr key={item.code}>
                  <th scope="row">{sayKnown(item.name)}</th>
                  <td>{item.need}</td>
                  <td>{item.have}</td>
                  <td className={short > 0 ? styles.short : styles.enough}>
                    {short > 0 ? copy.short(short) : copy.enough}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Request kit={props.kit} offline={props.offline} onKit={props.onKit} />
    </section>
  );
}
