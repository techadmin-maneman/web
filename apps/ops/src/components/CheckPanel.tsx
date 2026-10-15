// The check before a change is sent: what it was beside what it will be, and only the second press sends it
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md). Every write but a deletion goes through it, in the
// words of `review` (../content/common.ts). It takes the focus as it opens, so it is read at once.

import { useFocusOnMount } from "@maneman/ui/useFocusOnMount";
import { Button } from "@maneman/ui/Button";
import { useId, type ReactNode } from "react";
import { classes } from "@maneman/ui/classes";
import { review } from "../content/common.ts";
import look from "./check-panel.module.css";
import form from "./forms.module.css";
import { FormActions } from "./FormActions.tsx";

interface Props {
  /** A one-press action's question, "Pause Acme?"; a change made in boxes is "Review the change". */
  readonly question?: string;
  /** Each change, the old beside the new. */
  readonly lines?: readonly string[];
  /** What the change does that ops may not mean, in oxblood. */
  readonly warnings?: readonly string[];
  /** What lines alone cannot say, under them: a list of every figure a rule moves, say. */
  readonly children?: ReactNode;
  readonly busy: boolean;
  /** False when there is nothing to send: the lines then say so. */
  readonly ready?: boolean;
  readonly onSend: () => void;
  readonly onBack: () => void;
}

/** One line of the check: what changes, the old beside the new. */
export function CheckLine({ children }: { children: ReactNode }) {
  return <p className={look.line}>{children}</p>;
}

/** A line of the check that ops may not mean, in the warning's colour. */
export function CheckWarning({ children }: { children: ReactNode }) {
  return <p className={look.warning}>{children}</p>;
}

export function CheckPanel({
  question,
  lines = [],
  warnings = [],
  children,
  busy,
  ready = true,
  onSend,
  onBack,
}: Props) {
  const panel = useFocusOnMount<HTMLDivElement>();
  const nameId = useId();
  return (
    <div className={classes(look.check, form.check)} ref={panel} tabIndex={-1} role="group" aria-labelledby={nameId}>
      <p className={look.title} id={nameId}>
        {question ?? review.title}
      </p>
      {lines.map((line) => (
        <CheckLine key={line}>{line}</CheckLine>
      ))}
      {children}
      {warnings.map((line) => (
        <CheckWarning key={line}>{line}</CheckWarning>
      ))}
      <FormActions>
        <Button variant="primary" size="small" disabled={busy || !ready} onClick={onSend}>
          {busy ? review.sending : review.send}
        </Button>
        <Button variant="outline" size="small" narrow disabled={busy} onClick={onBack}>
          {question === undefined ? review.edit : review.cancel}
        </Button>
      </FormActions>
    </div>
  );
}
