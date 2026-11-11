// When a one visit's chosen hair system is fitted (docs/decisions/0247-the-steps-left.md): today, or another day ops
// book with the client, which closes the visit as a consultation going ahead, with nothing to pay now.

import { ToggleButton } from "@maneman/ui/ToggleButton";
import { capsLook } from "@maneman/ui/Caps";
import { oneVisit } from "../content.ts";
import shared from "./steps.module.css";

/** When the chosen hair system is fitted: today, or another day ops book with the client. */
export function When({ later, onLater }: { later: boolean; onLater: (later: boolean) => void }) {
  return (
    <section className={shared.field} aria-labelledby="client-when-title">
      <h2 className={capsLook(shared.fieldTitle)} id="client-when-title">
        {oneVisit.when}
      </h2>
      <div className={shared.choiceList}>
        <ToggleButton
          className={shared.choice}
          pressed={!later}
          onClick={() => {
            onLater(false);
          }}
        >
          {oneVisit.fitToday}
        </ToggleButton>
        <ToggleButton
          className={shared.choice}
          pressed={later}
          sub={oneVisit.bookLaterSub}
          onClick={() => {
            onLater(true);
          }}
        >
          {oneVisit.bookLater}
        </ToggleButton>
      </div>
      {later && <p className={shared.note}>{oneVisit.laterNote}</p>}
    </section>
  );
}
