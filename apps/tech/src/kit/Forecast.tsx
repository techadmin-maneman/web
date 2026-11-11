// The kit's next seven days (docs/prompts/tech-redesign.md, "Kit"): each consumable the visits booked from today on
// are expected to use, against what the kit holds, and how far short it falls, in red.

import { SectionHead } from "@maneman/ui/SectionHead";
import { Table } from "@maneman/ui/Table";
import type { Kit } from "../api.ts";
import { kit as kitCopy } from "../content.ts";
import styles from "./kit.module.css";

const copy = kitCopy.forecast;

export function Forecast({ forecast }: { readonly forecast: Kit["forecast"] }) {
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
    </section>
  );
}
