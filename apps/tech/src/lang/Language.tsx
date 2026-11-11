// Where the technician chooses the language (docs/prompts/tech-redesign.md, "Hindi and language switching"): under Me,
// a row that opens a sheet of the two; and on the sign-in screen, the other language by its own name, one tap away.

import { Button } from "@maneman/ui/Button";
import { ChoiceGroup, Radio } from "@maneman/ui/Field";
import { ListRow } from "@maneman/ui/ListRow";
import { Sheet, SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { useId, useState } from "react";
import { languageNames, me as copy } from "../content.ts";
import { chooseLanguage } from "./kept.ts";
import { useLanguage, type Language } from "./language.ts";
import styles from "./language.module.css";

const LANGUAGES: readonly Language[] = ["en", "hi"];

function LanguageSheet({ onClose }: { readonly onClose: () => void }) {
  const titleId = useId();
  const language = useLanguage();
  return (
    <Sheet labelledBy={titleId} rises={false} onClose={onClose}>
      <SheetClose onClose={onClose}>{copy.closeLanguage}</SheetClose>
      <SheetPanel className={styles.panel}>
        <h2 className={styles.title} id={titleId}>
          {copy.language}
        </h2>
        <ChoiceGroup legend={copy.language} legendLook="hidden" ruled>
          {LANGUAGES.map((each) => (
            <Radio
              key={each}
              name="language"
              lang={each}
              label={languageNames[each]}
              checked={language === each}
              onChange={() => {
                chooseLanguage(each);
                onClose();
              }}
            />
          ))}
        </ChoiceGroup>
      </SheetPanel>
    </Sheet>
  );
}

/** Me's row: the language now, by its own name, and the sheet to choose. */
export function LanguageRow() {
  const [open, setOpen] = useState(false);
  const language = useLanguage();
  return (
    <>
      <ListRow
        title={copy.language}
        meta={<span lang={language}>{languageNames[language]}</span>}
        onClick={() => {
          setOpen(true);
        }}
      />
      {open && (
        <LanguageSheet
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/** The sign-in's switch: the other language, by its own name. */
export function LanguageToggle({ className }: { readonly className?: string }) {
  const other: Language = useLanguage() === "hi" ? "en" : "hi";
  return (
    <Button
      variant="outline"
      size="small"
      className={className}
      lang={other}
      onClick={() => {
        chooseLanguage(other);
      }}
    >
      {languageNames[other]}
    </Button>
  );
}
