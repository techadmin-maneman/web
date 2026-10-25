// Finding discount codes by how they begin, however old, as it is typed: the list on Discount codes holds only the
// latest made.

import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { useEffect, useState } from "react";
import { settings } from "../content/settings.ts";
import styles from "./find-code.module.css";

const copy = settings.discountCodes;

/** A pause in typing long enough to look, so the codes are asked once a few letters are down. */
const FIND_AFTER_MS = 300;

export function FindForm({ finding, onFind }: { finding: string | null; onFind: (code: string | null) => void }) {
  const [text, setText] = useState(finding ?? "");
  useEffect(() => {
    const typed = text.trim() === "" ? null : text.trim();
    if (typed === finding) return;
    const wait = setTimeout(() => {
      onFind(typed);
    }, FIND_AFTER_MS);
    return () => {
      clearTimeout(wait);
    };
  }, [text, finding, onFind]);
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
      {finding !== null && (
        <Button
          variant="outline"
          size="small"
          narrow
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
