// The header's way to a client from any page: the Clients page's own search,
// which it opens on the words typed. They go in the history entry, never the
// address (lib/client-search.ts).

import { Button } from "@maneman/ui/Button";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useState } from "react";
import { shell } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { findFrom } from "../lib/client-search.ts";
import styles from "./shell.module.css";

export function ClientFinder() {
  const mayFind = useAccess().mayCall("POST /api/clients/find");
  const [text, setText] = useState("");
  if (!mayFind) return null;
  const typed = text.trim();
  return (
    <form
      className={styles.finder}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        if (typed !== "") findFrom(typed);
      }}
    >
      <label htmlFor="find-anywhere">
        <VisuallyHidden>{shell.find.label}</VisuallyHidden>
      </label>
      <input
        id="find-anywhere"
        className={styles.finderField}
        type="search"
        autoComplete="off"
        placeholder={shell.find.placeholder}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <Button variant="outline" size="small" type="submit" disabled={typed === ""}>
        {shell.find.submit}
      </Button>
    </form>
  );
}
