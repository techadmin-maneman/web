// What is switched off, retired or paused, listed apart beneath the live list under its own heading: never mixed in
// with what is in use, and only where there is any.
//
//   <Apart id="suppliers-retired" title={copy.retiredTitle}>
//     <SupplierTable rows={retired} />
//   </Apart>

import type { ReactNode } from "react";
import { typeLook } from "./type.ts";
import styles from "./apart.module.css";

export function Apart({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className={styles.apart} aria-labelledby={id}>
      <h3 className={typeLook("title-4", styles.title)} id={id}>
        {title}
      </h3>
      {children}
    </section>
  );
}
