// Why a write from the kit did not go through, with the API's reference to quote to ops where it gave one.

import { ErrorRef } from "@maneman/ui/ErrorRef";
import { reference } from "../content.ts";
import styles from "./kit.module.css";

/** Why a write did not go through; `requestId` is the API's, to quote to ops, and null when the phone said it. */
export interface Problem {
  readonly words: string;
  readonly requestId: string | null;
}

export function NotDone({ problem }: { readonly problem: Problem | null }) {
  if (problem === null) return null;
  return (
    <div role="alert">
      <p className={styles.problem}>{problem.words}</p>
      {problem.requestId !== null && <ErrorRef requestId={problem.requestId} words={reference} />}
    </div>
  );
}
