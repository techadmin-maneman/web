// Go to anything from anywhere (ADR 0225): the header's search at a desk, which "/" takes the keyboard to from anywhere
// but a box, and on a phone a sheet the search button opens. It finds clients by part of a name or four digits of a
// number, technicians by name, then the pages the person may open, Settings' among them; before anything is typed,
// the clients opened this session. Enter goes to the result moved to, or the first.

import { GLYPHS } from "@maneman/brand/icons";
import { Drawer } from "@maneman/ui/Drawer";
import { IconButton } from "@maneman/ui/IconButton";
import { go, usePath } from "@maneman/ui/router";
import { SearchMenu, type SearchGroup } from "@maneman/ui/SearchMenu";
import { useEffect, useRef, useState } from "react";
import { api, type ClientsFound } from "../api.ts";
import { CLOSE, shell, written } from "../content.ts";
import { useAccess, useMayCall } from "../lib/access.ts";
import { recentClients } from "../lib/client-search.ts";
import { phoneWords } from "../lib/phone.ts";
import {
  clientPath,
  mayOpen,
  mayOpenSetting,
  SECTION_NAMES,
  SECTIONS,
  settingsPath,
  SETTINGS_PAGE_NAMES,
  SETTINGS_PAGES,
  technicianPath,
} from "../route.ts";
import styles from "./search.module.css";

const words = shell.palette;

/** Two letters of a name, or four digits of a number, as the client search asks. */
const searchable = (text: string): boolean => /\p{L}.*\p{L}/u.test(text) || text.replace(/\D/g, "").length >= 4;

/** The clients the words find, once they are words a search takes; none while they are not. */
function useClients(text: string, mayFind: boolean): ClientsFound["clients"] {
  const [found, setFound] = useState<ClientsFound["clients"]>([]);
  useEffect(() => {
    if (!mayFind || !searchable(text)) {
      setFound([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      void api.findClients(text.trim()).then((answer) => {
        if (current) setFound(answer.ok ? answer.body.clients : []);
      });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text, mayFind]);
  return found;
}

type Named = readonly { readonly id: string; readonly name: string }[];

/** The roster, read once for this load of the console, and only once something is typed: never on a page's opening. */
let roster: Promise<Named> | null = null;

function rosterOnce(): Promise<Named> {
  roster ??= api.roster().then((answer) => {
    if (answer.ok) return [...answer.body.technicians, ...answer.body.switched_off];
    roster = null;
    return [];
  });
  return roster;
}

/** The technicians, for those who may read the roster, once the search is in use. */
function useTechnicians(wanted: boolean): Named {
  const [technicians, setTechnicians] = useState<Named>([]);
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    void rosterOnce().then((named) => {
      if (current) setTechnicians(named);
    });
    return () => {
      current = false;
    };
  }, [wanted]);
  return technicians;
}

/** What the words find, in the order the panel lists them: clients, technicians, then pages. */
function useResults(text: string, onGo: () => void): SearchGroup[] {
  const mayCall = useMayCall();
  const access = useAccess();
  const asked = text.trim().toLowerCase();
  const open = (to: string) => () => {
    onGo();
    go(to);
  };
  const found = useClients(text, access.mayCall("POST /api/clients/find"));
  const clients =
    asked === ""
      ? recentClients().map((each) => ({
          key: each.id,
          label: each.name,
          onChoose: open(clientPath(each.id, "history")),
        }))
      : found.map((each) => ({
          key: each.id,
          label: each.name,
          detail: phoneWords(each.mobile),
          onChoose: open(clientPath(each.id, "history")),
        }));
  const technicians = useTechnicians(access.mayCall("GET /api/technicians") && asked !== "")
    .filter((each) => asked !== "" && each.name.toLowerCase().includes(asked))
    .map((each) => ({ key: each.id, label: each.name, onChoose: open(technicianPath(each.id)) }));
  // A page is found by its own name: Settings' pages are not all found by "se".
  const pages = [
    ...SECTIONS.filter((each) => mayOpen(mayCall, each.page)).map((each) => ({
      key: each.page,
      name: SECTION_NAMES[each.page],
      label: SECTION_NAMES[each.page],
      onChoose: open(each.path),
    })),
    ...SETTINGS_PAGES.filter((each) => mayOpenSetting(mayCall, each.tab)).map((each) => ({
      key: `settings ${each.tab}`,
      name: SETTINGS_PAGE_NAMES[each.tab],
      label: words.setting(SETTINGS_PAGE_NAMES[each.tab]),
      onChoose: open(settingsPath(each.tab)),
    })),
  ].filter((page) => asked !== "" && page.name.toLowerCase().includes(asked));
  return [
    { key: "clients", name: words.clients, results: clients },
    { key: "technicians", name: words.technicians, results: technicians },
    { key: "pages", name: written(words.pages), results: pages },
  ];
}

/** Whether the keyboard is in a box, where "/" is a character typed rather than the way to the search. */
const inABox = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));

/** The header's search, which "/" takes the keyboard to from anywhere but a box. */
export function HeaderSearch({ className }: { readonly className?: string }) {
  const [text, setText] = useState("");
  const box = useRef<HTMLInputElement>(null);
  const groups = useResults(text, () => {
    setText("");
    box.current?.blur();
  });
  useEffect(() => {
    const takes = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || inABox(event.target)) return;
      event.preventDefault();
      box.current?.focus();
    };
    window.addEventListener("keydown", takes);
    return () => {
      window.removeEventListener("keydown", takes);
    };
  }, []);
  return (
    <SearchMenu
      className={className}
      label={words.label}
      value={text}
      onChange={setText}
      groups={groups}
      none={words.none}
      keyHint={shell.searchKey}
      inputRef={box}
    />
  );
}

/** On a phone, the search as a sheet of its own, the results beneath the box. */
function SearchSheet({ onClose }: { readonly onClose: () => void }) {
  const [text, setText] = useState("");
  const box = useRef<HTMLInputElement>(null);
  const groups = useResults(text, onClose);
  useEffect(() => {
    box.current?.focus();
  }, []);
  return (
    <Drawer titleId="search-sheet" title={shell.search} close={CLOSE} onDismiss={onClose}>
      <SearchMenu
        className={styles.sheet}
        label={words.label}
        value={text}
        onChange={setText}
        groups={groups}
        none={words.none}
        inputRef={box}
        open
      />
    </Drawer>
  );
}

/** The phone's search button, and the sheet it opens, which closes as a result's page opens. */
export function PhoneSearch() {
  const [open, setOpen] = useState(false);
  const path = usePath();
  useEffect(() => {
    setOpen(false);
  }, [path]);
  return (
    <>
      <IconButton
        d={GLYPHS.search}
        size="md"
        label={shell.search}
        onClick={() => {
          setOpen(true);
        }}
      />
      {open && (
        <SearchSheet
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
