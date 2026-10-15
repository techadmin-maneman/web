// A refusal, said where it happened. One because what ops acted on had changed or gone since the page opened
// (content/common.ts's `changed`) has the page read again in place, so the latest is on screen rather than a request
// to reload it.

import { InlineMessage } from "@maneman/ui/InlineMessage";
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

/** A form's own refusal, where there is one: formError's words, null when a box's Field says it, or nothing failed. */
export function FormRefusal({ said, className }: { readonly said: string | null; readonly className?: string }) {
  return said === null ? null : <Refusal className={className} said={said} />;
}
