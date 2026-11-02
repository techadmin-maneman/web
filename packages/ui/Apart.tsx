// What is switched off, retired or paused: a panel of its own beneath the live list's, folded until asked for, its
// head saying how many. Never mixed in with what is in use, and only where there is any.
//
//   <Apart id="suppliers-retired" title={copy.retiredTitle} count={retired.length}>
//     <SupplierTable rows={retired} />
//   </Apart>

import { GLYPHS } from "@maneman/brand/icons";
import type { ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import { typeLook } from "./type.ts";
import styles from "./apart.module.css";

export function Apart({
  id,
  title,
  count,
  children,
}: {
  readonly id: string;
  readonly title: string;
  /** How many it holds, said in its head while it is folded. */
  readonly count: number;
  readonly children: ReactNode;
}) {
  return (
    <section className={styles.apart} aria-labelledby={id}>
      <details>
        <summary className={styles.head}>
          <h2 className={typeLook("title-4", styles.title)} id={id}>
            {title}
          </h2>
          <span className={styles.count}>{count}</span>
          <Icon className={styles.sign} d={GLYPHS.chevron} size="sm" />
        </summary>
        {children}
      </details>
    </section>
  );
}
