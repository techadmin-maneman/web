// A document the API serves, as a row to tap: opened in a tab of its own once it has come (../lib/documents.ts), and
// said here instead where the API would not give it.

import { DocumentButton } from "@maneman/ui/DocumentLink";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState, type ReactNode } from "react";
import { payments } from "../content.ts";
import { openDocument, type Opened } from "../lib/documents.ts";

/** `notReady`: what the page says of this document while it is not yet raised. */
export function OpenDocument(props: { url: string; notReady: string; children: ReactNode }) {
  const [said, setSaid] = useState<Opened>("opened");
  const [busy, once] = useOneAtATime();
  const words: Record<Opened, string | null> = { opened: null, not_ready: props.notReady, failed: payments.notOpened };
  const line = words[said];
  return (
    <>
      <DocumentButton
        aria-busy={busy}
        onClick={() =>
          void once(async () => {
            setSaid(await openDocument(props.url));
          })
        }
      >
        {props.children}
      </DocumentButton>
      {line !== null && <InlineMessage tone="error">{line}</InlineMessage>}
    </>
  );
}
