// A refusal, said where it happened. One because what ops acted on had changed or gone since the page opened
// (content/common.ts's `changed`) has the page read again in place, so the latest is on screen rather than a request
// to reload it.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { errorText, formError, type Failure } from "@maneman/web-kit/refusal";
import { useEffect, type ReactNode } from "react";
import { isChanged, LATEST } from "../content/common.ts";
import { useRefreshPage } from "../lib/refresh.ts";

/** Reads the page again when the refusal shown, if any, is one `changed` named. */
export function useRereadOnChange(said: string | null): void {
  const refresh = useRefreshPage();
  useEffect(() => {
    if (said !== null && isChanged(said)) refresh(`${said} ${LATEST}`);
  }, [refresh, said]);
}

export function Refusal({
  said,
  className,
  children,
}: {
  readonly said: string;
  readonly className?: string | undefined;
  /** What follows the words: a link to where the refusal is settled, say. */
  readonly children?: ReactNode;
}) {
  useRereadOnChange(said);
  return (
    <InlineMessage tone="error" className={className}>
      {said}
      {children}
    </InlineMessage>
  );
}

/**
 * A form's refusal: said here, but for one that names a box among `boxes`, which that box's Field says. That one is
 * still told to a screen reader once, as the press it answers sent it, since a Field's own words are read only when
 * the box is reached.
 */
export function FormRefusal(props: {
  readonly errors: Readonly<Record<string, string | undefined>>;
  readonly failure: Failure | null;
  readonly boxes: readonly string[];
  readonly className?: string;
}) {
  if (props.failure === null) return null;
  const said = formError(props.errors, props.failure, props.boxes);
  if (said !== null) return <Refusal className={props.className} said={said} />;
  return (
    <VisuallyHidden>
      <span role="alert">{errorText(props.errors, props.failure)}</span>
    </VisuallyHidden>
  );
}
