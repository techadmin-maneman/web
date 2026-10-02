// The WhatsApp code's field, beneath the number it went to (useNumberCode.ts). /book and /try each give it their own
// classes, on paper and on ink.

import { useEffect, useRef } from "preact/hooks";
import { numberCode as words } from "../content/site.ts";

/** A CSS module's classes, each of which the module may lack. */
export interface CodeFieldClasses {
  readonly label: string | undefined;
  readonly input: string | undefined;
  readonly bad: string | undefined;
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
  classes: CodeFieldClasses;
  onInput: (code: string) => void;
  onAgain: (event: Event) => void;
}) {
  const { idPrefix, classes, failure } = props;
  const field = useRef<HTMLInputElement>(null);
  const bad = failure !== null;
  const hintId = `${idPrefix}-code-hint`;
  const errorId = `${idPrefix}-code-error`;

  // The field appears once the code is on its way, and is where the visitor goes next.
  useEffect(() => {
    field.current?.focus();
  }, []);

  return (
    <div>
      <label class={classes.label} for={`${idPrefix}-code`}>
        {words.label}
      </label>
      <input
        ref={field}
        id={`${idPrefix}-code`}
        class={[classes.input, bad ? classes.bad : ""].join(" ")}
        value={props.code}
        inputMode="numeric"
        autocomplete="one-time-code"
        maxLength={6}
        aria-required="true"
        aria-invalid={bad}
        aria-describedby={bad ? `${hintId} ${errorId}` : hintId}
        onInput={(event) => {
          props.onInput(event.currentTarget.value);
        }}
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
      <button
        type="button"
        class={classes.again}
        onClick={(event) => {
          props.onAgain(event);
        }}
      >
        {words.again}
      </button>
    </div>
  );
}
