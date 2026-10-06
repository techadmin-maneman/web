# The texts file

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

Every WhatsApp message and every line of copy still marked PLACEHOLDER go to the owner in one Word file to mark up with tracked changes (`docs/open-points.md`, items 39, 41 and 42):

```sh
npm run texts:export              # writes private/texts-<today>.docx
```

It lists each message by its template name, with the note on when it is sent and what its `{{1}}`, `{{2}}` stand for, and each line of copy by the file and line of its mark, grouped by file. The consent notices are listed at the end and are not for editing there: a notice is replaced by a new version counsel approves, never edited. `private/` is git-ignored.

The owner's wording comes back by hand: find each changed item by its id (`src/config/message-templates.ts` for a message; the file and line for the rest), put the words in, and take the PLACEHOLDER mark off what they approved. A message's text must keep the same `{{n}}` it had, unless the code that fills it changes too.
