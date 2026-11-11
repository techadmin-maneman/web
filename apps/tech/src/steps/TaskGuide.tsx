// A guided task's words (../visit/tasks.ts): its reference photograph, the numbered instructions and what to watch for.
// The checklist step shows them above its Done (./Checklist.tsx), and Guides alone, read-only (../guides/).

import { visit } from "../content.ts";
import type { TaskWords } from "../visit/index.ts";
import styles from "./steps.module.css";

export function TaskGuide({ words }: { readonly words: TaskWords }) {
  return (
    <>
      {words.reference !== "" && (
        <div className={styles.reference} role="img" aria-label={visit.reference(words.reference)}>
          {visit.reference(words.reference)}
        </div>
      )}
      {words.how.length > 0 && (
        <ol className={styles.how}>
          {words.how.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      )}
      {words.watch !== null && (
        <div className={styles.watch}>
          <p className={styles.watchTitle}>{visit.watchFor}</p>
          <p className={styles.watchLine}>{words.watch}</p>
        </div>
      )}
    </>
  );
}
