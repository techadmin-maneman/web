// A line's record (docs/decisions/0126-the-words-page.md): the code's wording, and the line's own, changed where it
// reads, with the holes the page fills to keep and the length the layout holds beneath it; then its history, where an
// earlier wording opens the line's box with it, to read before it is kept.

import { EditableRow } from "@maneman/ui/EditableRow";
import { TextArea } from "@maneman/ui/Field";
import { TextLink } from "@maneman/ui/TextLink";
import { errorText } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { type Word } from "../api.ts";
import { ReadRow } from "../components/RecordRows.tsx";
import form from "../components/forms.module.css";
import { BOOKING_URL, EDITING } from "../content/common.ts";
import { words as copy } from "../content/words.ts";
import { useAccess } from "../lib/access.ts";
import { WordHistory } from "./WordHistory.tsx";
import styles from "./word-form.module.css";
import { wordsApi } from "./words-api.ts";

const { form: formWords } = copy;

/** What the page or the sender fills: "{city}", "{{2}}". */
const holesOf = (text: string): string[] => [...new Set(text.match(/\{\{\d+\}\}|\{[a-zA-Z]+\}/g) ?? [])];

/** Whether messages send in new words at once, as the bridge does, or once WhatsApp approves them, as MSG91 does. */
export type Messages = "at_once" | "after_approval";

/**
 * A part of a line's place in words: "howItWorks" is "How it works", "visit_reminder_v1" is "Visit reminder". A part
 * named in the content keeps its own capitals: "WhatsApp button".
 */
function partOf(name: string): string {
  const named = copy.places[name];
  if (named !== undefined) return named;
  const said = name
    .replace(/_v\d+$/, "")
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return (said.charAt(0).toUpperCase() + said.slice(1)).replace(/\bwhatsapp\b/gi, "WhatsApp");
}

/** The site's own address in this environment, whose pages a line is seen on. */
const SITE = new URL(BOOKING_URL[import.meta.env.MM_ENV]).origin;

/** The page a site line is seen on, by its page and part; none for a message or a line on no one page. */
const PAGES: Readonly<Record<string, string | undefined>> = {
  home: "/",
  contact: "/",
  tryon: "/try",
  guides: "/guides",
  booking: "/book",
  stopMessages: "/stop",
  areasPage: "/areas",
  cityPage: "/areas",
};

function pageOf(word: Word): string | null {
  const [, page = "", part = ""] = /^site:([^/]+)\/([^.]+)/.exec(word.key) ?? [];
  const path = PAGES[part] ?? PAGES[page];
  return path === undefined ? null : `${SITE}${path}`;
}

/** Where a line sits, as the table names it: "Header · Menu link 1 · Label"; a message by its name. */
export function placeOf(word: Word): string {
  const path = word.key.replace(/^site:[^/]+\//, "").replace(/^message:/, "");
  const parts: string[] = [];
  for (const name of path.split(".")) {
    const last = parts.length - 1;
    if (/^\d+$/.test(name) && last >= 0) parts[last] = `${parts[last] ?? ""} ${String(Number(name) + 1)}`;
    else parts.push(partOf(name));
  }
  return parts.join(" · ");
}

export function WordRecord(props: {
  readonly word: Word;
  readonly messages: Messages;
  readonly onSaved: (word: Word) => void;
}) {
  const { word } = props;
  const mayChange = useAccess().mayCall("POST /api/words");
  /** An earlier wording chosen from the history, which the box opens with, and how many times one has been. */
  const [used, setUsed] = useState<string | null>(null);
  const [uses, setUses] = useState(0);
  const holes = holesOf(word.text);
  const page = pageOf(word);
  return (
    <>
      <div className={form.record}>
        <ReadRow label={formWords.code} value={word.text} />
        <EditableRow<string>
          key={uses}
          label={formWords.wording}
          words={EDITING}
          mayChange={mayChange}
          opened={used !== null}
          value={<span className={styles.said}>{word.now}</span>}
          start={() => used ?? word.now}
          save={async (typed) => {
            if (typed.trim() === "") return copy.errors.empty;
            const answer = await wordsApi.setWord(word.key, typed === word.text ? null : typed);
            if (!answer.ok) return errorText(copy.errors, answer);
            setUsed(null);
            props.onSaved(answer.body.word);
            return null;
          }}
        >
          {(control, typed, type) => (
            <TextArea
              {...control}
              className={styles.box}
              rows={word.surface === "message" ? 5 : 3}
              maxLength={word.longest}
              value={typed}
              onChange={(event) => {
                type(event.target.value);
              }}
            />
          )}
        </EditableRow>
      </div>
      {page !== null && (
        <p className={styles.hint}>
          <TextLink href={page} newTab>
            {copy.seePage}
          </TextLink>
        </p>
      )}
      <p className={styles.hint}>
        {holes.length > 0 && `${formWords.keep(holes.join(", "))} `}
        {formWords.longest(word.longest)}
      </p>
      {word.surface === "message" && (
        <p className={styles.hint}>{props.messages === "at_once" ? formWords.atOnce : formWords.afterApproval}</p>
      )}
      <WordHistory
        word={word}
        mayChange={mayChange}
        onUse={(text) => {
          setUsed(text);
          setUses(uses + 1);
        }}
      />
    </>
  );
}
