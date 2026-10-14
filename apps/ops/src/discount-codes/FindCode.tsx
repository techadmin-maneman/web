// Finding discount codes by how they begin, however old: the list on Discount codes holds only the latest made.

import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { useState } from "react";
import { settings } from "../content/settings.ts";
import form from "../components/forms.module.css";
import styles from "./discount-codes.module.css";

const copy = settings.discountCodes;

export function FindForm({ finding, onFind }: { finding: string | null; onFind: (code: string | null) => void }) {
  const [text, setText] = useState(finding ?? "");
  return (
    <form
      className={styles.find}
      role="search"
      aria-label={copy.find}
      onSubmit={(event) => {
        event.preventDefault();
        onFind(text.trim() === "" ? null : text.trim());
      }}
    >
      <Field label={copy.find}>
        {(control) => (
          <TextInput
            {...control}
            type="search"
            value={text}
            onChange={(event) => {
              setText(event.currentTarget.value);
            }}
          />
        )}
      </Field>
      <Button type="submit" variant="outline" size="small" className={form.quiet}>
        {copy.findButton}
      </Button>
      {finding !== null && (
        <Button
          variant="outline"
          size="small"
          className={form.quiet}
          onClick={() => {
            setText("");
            onFind(null);
          }}
        >
          {copy.showAll}
        </Button>
      )}
    </form>
  );
}
