// What an erasure destroys and what it keeps, which ops read before they erase anyone: from a deletion request, or
// from a client's page.

import { capsLook } from "@maneman/ui/Caps";
import { deletions } from "../content.ts";
import styles from "./erasure.module.css";

function What({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className={styles.what}>
      <h4 className={capsLook(styles.whatTitle)}>{title}</h4>
      <ul className={styles.whatItems}>
        {items.map((item) => (
          <li key={item} className={styles.whatItem}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ErasureLists() {
  return (
    <>
      <What title={deletions.queue.deleted.title} items={deletions.queue.deleted.items} />
      <What title={deletions.queue.kept.title} items={deletions.queue.kept.items} />
    </>
  );
}
