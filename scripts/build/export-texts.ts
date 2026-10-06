// Writes the texts file that is marked up with tracked changes: every
// WhatsApp message and every line of copy marked PLACEHOLDER, grouped by message and by file, each with the id that
// finds it again. Their wording comes back by hand, one id at a time (docs/runbook.md, "The texts file").
//
//   npm run texts:export              writes private/texts-<today>.docx
//   npm run texts:export -- <path>    writes it there
//
// private/ is git-ignored: the file holds nothing secret, but it is a working copy, not a record.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { TEMPLATES } from "../../src/config/message-templates.ts";
import { NOTICES } from "../../src/config/notices.ts";
import { copyFiles, messageTexts, placeholderTexts, type PlaceholderText } from "../lib/texts.ts";

const root = process.cwd();
const out = process.argv[2] ?? `private/texts-${new Date().toISOString().slice(0, 10)}.docx`;

const messages = messageTexts(TEMPLATES, readFileSync("src/config/message-templates.ts", "utf8"));
const placeholders = placeholderTexts(copyFiles(root));

const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) =>
  new Paragraph({ text, heading: level });
const note = (text: string) => new Paragraph({ children: [new TextRun({ text, italics: true, color: "666666" })] });
const id = (text: string) => new Paragraph({ children: [new TextRun({ text, bold: true, font: "Consolas" })] });
const copy = (text: string) => new Paragraph({ children: [new TextRun({ text, font: "Consolas" })] });

function byFile(items: readonly PlaceholderText[]): Map<string, PlaceholderText[]> {
  const files = new Map<string, PlaceholderText[]>();
  for (const item of items) {
    const file = item.id.slice(0, item.id.lastIndexOf(":"));
    files.set(file, [...(files.get(file) ?? []), item]);
  }
  return files;
}

const body: Paragraph[] = [
  heading("Mane Man: the words to approve", HeadingLevel.TITLE),
  note(
    "Change any wording with tracked changes on. Keep each bold id as it is: it is how your wording finds its " +
      "place again. {{1}}, {{2}} and so on in a message are filled in when it is sent; the note above each says with what.",
  ),
  heading(`WhatsApp messages (${String(messages.length)})`, HeadingLevel.HEADING_1),
  ...messages.flatMap((message) => [
    id(message.name),
    ...(message.note === "" ? [] : [note(message.note)]),
    copy(message.text),
  ]),
  heading(`Placeholder copy (${String(placeholders.length)})`, HeadingLevel.HEADING_1),
  ...[...byFile(placeholders)].flatMap(([file, items]) => [
    heading(file, HeadingLevel.HEADING_2),
    ...items.flatMap((item) => [id(item.id), ...(item.note === "" ? [] : [note(item.note)]), copy(item.source)]),
  ]),
  heading("Consent notices: for counsel, not to edit here", HeadingLevel.HEADING_1),
  note(
    "Which words a person agreed to is a legal record: a notice is never edited, only replaced by a new version " +
      "counsel approves. They are listed so you can see them.",
  ),
  ...NOTICES.map((notice) => copy(`${notice.version} (${notice.purpose})`)),
];

const document = new Document({ sections: [{ children: body }] });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, await Packer.toBuffer(document));
console.log(`${out}: ${String(messages.length)} messages, ${String(placeholders.length)} placeholder lines`);
