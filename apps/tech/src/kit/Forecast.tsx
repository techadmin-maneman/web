// The kit's next seven days (docs/prompts/tech-redesign.md, "Kit"): each consumable the visits booked from today on
// are expected to use, against what the kit holds, and how far short it falls, in red.

import { Button } from "@maneman/ui/Button";
import { SectionHead } from "@maneman/ui/SectionHead";
import { Table } from "@maneman/ui/Table";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { api, type Kit } from "../api.ts";
import { kit as kitCopy } from "../content.ts";
import { clock } from "../lib/when.ts";
import styles from "./kit.module.css";

const copy = kitCopy.forecast;

/** The one tap that asks ops for what is short, straight with signal; or, once asked, when, until ops settle it. */
function Request(props: { readonly kit: Kit; readonly offline: boolean; readonly onKit: (kit: Kit) => void }) {
  const [failed, setFailed] = useState(false);
  const [busy, once] = useOneAtATime();
  if (props.kit.asked !== null) {
    return (
      <p className={styles.note} role="status">
        {copy.requested(clock(props.kit.asked.asked_at))}
      </p>
    );
  }
  if (!props.kit.forecast.some((item) => item.need > Math.max(item.have, 0))) return null;
  const ask = () =>
    once(async () => {
      const answer = await api.kitRequest();
      setFailed(!answer.ok);
      if (answer.ok) props.onKit(answer.body);
    });
  return (
    <div className={styles.buttons}>
      {failed && (
        <p className={styles.problem} role="alert">
          {copy.requestFailed}
        </p>
      )}
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
                  <th scope="row">{item.name}</th>
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
