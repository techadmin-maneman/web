// On a replacement whose piece came off before it was due (docs/decisions/0273-why-a-hair-system-failed.md): a quiet
// link beneath what is expected, then the light sheet "Can't fit today" uses, with the reasons ops keep as chips. One
// tap, never asked for: the piece that came off is recorded as failed for the reason picked, and as replaced with none.
// A chip tapped again is put back, and Done then says nothing.

import { Button } from "@maneman/ui/Button";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { TextButton } from "@maneman/ui/TextLink";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { useId, useState } from "react";
import type { Job } from "../api.ts";
import { steps } from "../content.ts";
import { sayKnown, theirs } from "../lang/index.ts";
import sheet from "./cannot-fit.module.css";
import styles from "./came-off-early.module.css";

const copy = steps.piece.cameOffEarly;

type Reasons = Job["failure_reasons"];

function ReasonSheet(props: {
  readonly reasons: Reasons;
  readonly picked: string | null;
  readonly onPick: (reason: string | null) => void;
  readonly onCancel: () => void;
}) {
  const titleId = useId();
  const [reason, setReason] = useState(props.picked);
  return (
    <Sheet labelledBy={titleId} rises={false} onClose={props.onCancel}>
      <SheetClose onClose={props.onCancel}>{copy.dismiss}</SheetClose>
      <SheetPanel className={sheet.panel}>
        <h2 className={sheet.title} id={titleId}>
          {copy.title}
        </h2>
        <div className={sheet.reasons} role="group" aria-labelledby={titleId}>
          {props.reasons.map((each) => (
            <ToggleButton
              key={each.id}
              filled
              pressed={reason === each.id}
              onClick={() => {
                setReason(reason === each.id ? null : each.id);
              }}
            >
              {sayKnown(each.label)}
            </ToggleButton>
          ))}
        </div>
        <Button
          variant="primary"
          size="action"
          onClick={() => {
            props.onPick(reason);
          }}
        >
          {copy.done}
        </Button>
      </SheetPanel>
    </Sheet>
  );
}

/** The link, or the reason picked with Change, and the sheet either opens. None where ops keep no reasons. */
export function CameOffEarly({
  reasons,
  picked,
  onPick,
}: {
  readonly reasons: Reasons;
  /** The reason picked, by its code; null for none. */
  readonly picked: string | null;
  readonly onPick: (reason: string | null) => void;
}) {
  const [asking, setAsking] = useState(false);
  if (reasons.length === 0) return null;
  const label = reasons.find((each) => each.id === picked)?.label ?? null;
  const ask = () => {
    setAsking(true);
  };
  return (
    <>
      {label === null ? (
        <TextButton className={sheet.action} onClick={ask}>
          {copy.action}
        </TextButton>
      ) : (
        <p className={styles.said}>
          <span>{copy.said(theirs(sayKnown(label)))}</span>
          <TextButton className={sheet.action} onClick={ask}>
            {copy.change}
          </TextButton>
        </p>
      )}
      {asking && (
        <ReasonSheet
          reasons={reasons}
          picked={picked}
          onPick={(reason) => {
            setAsking(false);
            onPick(reason);
          }}
          onCancel={() => {
            setAsking(false);
          }}
        />
      )}
    </>
  );
}
