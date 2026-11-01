// A box for the client's own words, up to a limit, which says beneath it how much is left: a note, a dispute, a
// problem, a concern about their data.

import { Field, TextArea } from "./Field.tsx";
import { charactersLeft } from "./words.ts";

export function WordsField(props: {
  label: string;
  text: string;
  max: number;
  className?: string | undefined;
  onText: (text: string) => void;
}) {
  return (
    <Field className={props.className} label={props.label} hint={charactersLeft(props.max - props.text.length)}>
      {(control) => (
        <TextArea
          {...control}
          rows={4}
          maxLength={props.max}
          required
          value={props.text}
          onChange={(event) => {
            props.onText(event.target.value);
          }}
        />
      )}
    </Field>
  );
}
