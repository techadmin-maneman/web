// A form's own action, beside its Cancel (./CancelButton.tsx): filled, small and the form's submit, its icon a check
// unless what it does names another, as a mark of failure or a refund's banknote.
//
//   <FormActions>
//     <SubmitButton busy={busy}>{copy.save}</SubmitButton>
//     <CancelButton onClick={close} />
//   </FormActions>

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { Button, type ButtonProps } from "./Button.tsx";

type SubmitProps = Omit<ButtonProps, "variant" | "size" | "type"> & { readonly variant?: ButtonProps["variant"] };

export function SubmitButton({ variant = "primary", icon = ACTION_ICONS.check, ...rest }: SubmitProps) {
  return <Button {...rest} variant={variant} size="small" type="submit" icon={icon} />;
}
