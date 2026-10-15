// The WhatsApp code's field, beneath the number it went to (useNumberCode.ts): the shared field, on /book's paper or
// /try's ink, with each page's own words beneath it.

import "./refs-as-props.ts";
import { CodeField } from "@maneman/ui/CodeField";
import { Label } from "@maneman/ui/Field";
import { TextButton } from "@maneman/ui/TextLink";
import { useEffect, useRef } from "preact/hooks";
import { numberCode as words } from "../content/site.ts";

/** A page's classes for the words beneath the field, and for where "Send again" stands. */
export interface CodeFieldClasses {
  readonly hint: string | undefined;
  readonly error: string | undefined;
  readonly again: string | undefined;
}

export function NumberCodeField(props: {
  idPrefix: string;
  /** The number as its field shows it, "98100 00000". */
  mobile: string;
  code: string;
  failure: string | null;
  onInk: boolean;
  classes: CodeFieldClasses;
  onInput: (code: string) => void;
  onAgain: (event: Event) => void;
}) {
  const { idPrefix, onInk, classes, failure } = props;
  const field = useRef<HTMLInputElement>(null);
  const bad = failure !== null;
  const hintId = `${idPrefix}-code-hint`;
  const errorId = `${idPrefix}-code-error`;

  // The field appears once the code is on its way, and is where the visitor goes next.
  useEffect(() => {
    field.current?.focus();
  }, []);

  return (
    <div data-ground={onInk ? "ink" : undefined}>
      <Label htmlFor={`${idPrefix}-code`} onInk={onInk}>
        {words.label}
      </Label>
      <CodeField
        id={`${idPrefix}-code`}
        ref={field}
        label={words.label}
        value={props.code}
        invalid={bad}
        describedBy={bad ? `${hintId} ${errorId}` : hintId}
        onChange={props.onInput}
      />
      <p id={hintId} class={classes.hint}>
        {`${words.sentTo}${props.mobile}. ${words.hint}`}
      </p>
      <div aria-live="polite">
        {bad && (
          <div id={errorId} class={classes.error}>
            {failure}
          </div>
        )}
      </div>
      <TextButton
        tone={onInk ? "ink" : "plain"}
        className={classes.again}
        onClick={(event) => {
          props.onAgain(event);
        }}
      >
        {words.again}
      </TextButton>
    </div>
  );
}
