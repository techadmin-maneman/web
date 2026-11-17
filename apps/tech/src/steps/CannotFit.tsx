// "Can't fit today" (docs/decisions/0269-the-design-checks-api-side.md), as the prototype draws it: a link beneath the
// scanner, then a light sheet asking why, from the reasons ops keep, and the close off until one is picked. The fit
// closes as not fitted from here, and ops are given its refit to book. A card kept before the list reached the phone
// has none to offer, and closes with no reason, as it did.

import { Button } from "@maneman/ui/Button";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { TextButton } from "@maneman/ui/TextLink";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { useId, useState } from "react";
import type { Job } from "../api.ts";
import { steps } from "../content.ts";
import { sayKnown } from "../lang/index.ts";
import styles from "./cannot-fit.module.css";

const copy = steps.piece.cannotFit;

function CannotFitSheet(props: {
  readonly reasons: Job["not_fitted_reasons"];
  readonly onClose: (reason: string | null) => void;
  readonly onCancel: () => void;
}) {
  const titleId = useId();
  const [reason, setReason] = useState<string | null>(null);
  const asks = props.reasons.length > 0;
  return (
    <Sheet labelledBy={titleId} rises={false} onClose={props.onCancel}>
      <SheetClose onClose={props.onCancel}>{copy.dismiss}</SheetClose>
      <SheetPanel className={styles.panel}>
        <h2 className={styles.title} id={titleId}>
          {copy.title}
        </h2>
        {asks && (
          <>
            <p className={styles.why} id={`${titleId}-why`}>
              {copy.why}
            </p>
            <div className={styles.reasons} role="group" aria-labelledby={`${titleId}-why`}>
              {props.reasons.map((each) => (
                <ToggleButton
                  key={each.id}
                  filled
                  pressed={reason === each.id}
                  onClick={() => {
                    setReason(each.id);
                  }}
                >
                  {sayKnown(each.label)}
                </ToggleButton>
              ))}
            </div>
          </>
        )}
        <p className={styles.body}>{copy.body}</p>
        <Button
          variant="primary"
          size="action"
          disabled={asks && reason === null}
          onClick={() => {
            props.onClose(reason);
          }}
        >
          {copy.close}
        </Button>
      </SheetPanel>
    </Sheet>
  );
}

/** The link, and the sheet it opens. `onClose` closes the fit as not fitted, with the reason picked. */
export function CannotFit({
  reasons,
  onClose,
}: {
  readonly reasons: Job["not_fitted_reasons"];
  readonly onClose: (reason: string | null) => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <TextButton
        onClick={() => {
          setAsking(true);
        }}
      >
        {copy.action}
      </TextButton>
      {asking && (
        <CannotFitSheet
          reasons={reasons}
          onClose={onClose}
          onCancel={() => {
            setAsking(false);
          }}
        />
      )}
    </>
  );
}
