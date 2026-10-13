// A first fit or replacement we owe the client again, free (docs/decisions/0192-free-remakes.md): ops call to book
// it, so Home offers nothing to book or pay in its place.

import { capsLook } from "@maneman/ui/Caps";
import type { Me } from "../api.ts";
import { home } from "../content.ts";
import styles from "./home.module.css";

export function RemakeCard({ remake }: { remake: NonNullable<Me["remake"]> }) {
  const copy = home.remake;
  return (
    <section className={styles.nothing} aria-labelledby="remake">
      <h1 className={capsLook(styles.label)} id="remake">
        {copy.label[remake.type]}
      </h1>
      <p>{remake.why === "recall" ? copy.recall : copy.partial}</p>
    </section>
  );
}
