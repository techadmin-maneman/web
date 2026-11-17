// When a one visit's chosen hair system is fitted (docs/decisions/0247-the-steps-left.md): today, or another day ops
// book with the client, which closes the visit as a consultation going ahead, with nothing to pay now.

import { ChoiceGroup, Radio } from "@maneman/ui/Field";
import { oneVisit } from "../content.ts";
import shared from "./steps.module.css";
import { theirs } from "../lang/index.ts";

/**
 * When the chosen hair system is fitted: today, only where the kit holds one, or another day ops book with the
 * client; radio rows with their second lines, as the prototype draws them.
 */
export function When({
  product,
  canFitToday,
  later,
  onLater,
}: {
  product: string;
  canFitToday: boolean;
  later: boolean;
  onLater: (later: boolean) => void;
}) {
  return (
    <div className={shared.field}>
      <ChoiceGroup legend={oneVisit.when} legendLook="caps" ruled>
        <Radio
          name="when"
          label={oneVisit.fitToday}
          detail={canFitToday ? oneVisit.inKit(theirs(product)) : oneVisit.notInKit(theirs(product))}
          checked={!later}
          disabled={!canFitToday}
          onChange={() => {
            onLater(false);
          }}
        />
        <Radio
          name="when"
          label={oneVisit.bookLater}
          detail={oneVisit.bookLaterSub}
          checked={later}
          onChange={() => {
            onLater(true);
          }}
        />
      </ChoiceGroup>
      {later && <p className={shared.ruledNote}>{oneVisit.laterNote}</p>}
    </div>
  );
}
