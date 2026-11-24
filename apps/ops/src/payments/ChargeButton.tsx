// A no-show case's charge (./NoShowsScreen.tsx), in words and an icon that fit what it would keep: Close as no-show,
// a ringed check, where it keeps nothing; Charge, coins in hand, where it keeps money or a free visit.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { Button } from "@maneman/ui/Button";
import { type Loaded, useLoad } from "@maneman/ui/useLoad";
import { type RefObject, useCallback } from "react";
import { type ChargePreview } from "../api.ts";
import { noShows } from "../content.ts";
import { paymentsApi } from "./payments-api.ts";

const copy = noShows.queue;

/** Nothing paid and no free visit used: the rule charges nothing, so the case is closed as a no-show, not charged. */
export const keepsNothing = (preview: Loaded<ChargePreview>): boolean =>
  preview.state === "loaded" && preview.value.paid === 0 && !preview.value.credit_kept;

export function ChargeButton(props: {
  caseId: string;
  sending: boolean;
  disabled: boolean;
  waits: string | undefined;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
}) {
  const { caseId } = props;
  const [preview] = useLoad(useCallback(() => paymentsApi.chargePreview(caseId), [caseId]));
  const closes = keepsNothing(preview);
  const words = closes ? copy.closeNoShow : copy.charge;
  return (
    <Button
      icon={closes ? ACTION_ICONS.circleCheck : ACTION_ICONS.handCoins}
      variant="primary"
      size="small"
      ref={props.buttonRef}
      disabled={props.disabled}
      aria-describedby={props.waits}
      onClick={props.onClick}
    >
      {props.sending ? copy.deciding : words}
    </Button>
  );
}
