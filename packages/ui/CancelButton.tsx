// The way out of a form or a question, and the step back, drawn and said the same on every screen: beside the form's
// own action, outlined and a little narrower than it.
//
//   <FormActions>
//     <Button variant="primary" size="small" type="submit">{copy.save}</Button>
//     <CancelButton onClick={close} />
//   </FormActions>

import { Button, type ButtonProps } from "./Button.tsx";
import { DISMISS } from "./words.ts";

type DismissProps = Omit<ButtonProps, "variant" | "size" | "narrow" | "className" | "children">;

/** Cancel; `keep` where what is asked is itself a cancelling or a withdrawal, which then reads Keep it. */
export function CancelButton({ keep = false, ...rest }: DismissProps & { readonly keep?: boolean }) {
  return (
    <Button {...rest} variant="outline" size="small" narrow>
      {keep ? DISMISS.keep : DISMISS.cancel}
    </Button>
  );
}

/** Back, to the step before, as from a check to the boxes it checks. */
export function BackButton(props: DismissProps) {
  return (
    <Button {...props} variant="outline" size="small" narrow>
      {DISMISS.back}
    </Button>
  );
}
