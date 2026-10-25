// Go to anything from anywhere: Ctrl K (or ⌘K), or the frame's Search, opens a box that finds the pages the person
// may open by their names, Settings' among them, technicians by name, and clients by part of a name or four digits of a
// number; before anything is typed, the clients opened this session come first. Enter goes to the first found, the
// arrow keys move through them, and Escape closes it.

import { Dialog } from "@maneman/ui/Dialog";
import { Field, TextInput } from "@maneman/ui/Field";
import { go, Link, usePath } from "@maneman/ui/router";
import { textLinkLook } from "@maneman/ui/TextLink";
import { typeLook } from "@maneman/ui/type";
import { useEffect, useRef, useState } from "react";
import { api, type ClientsFound } from "../api.ts";
import { shell } from "../content.ts";
import { useAccess, useMayCall } from "../lib/access.ts";
import { phoneWords } from "../lib/phone.ts";
import { recentClients } from "../lib/client-search.ts";
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
import styles from "./command-palette.module.css";

const words = shell.palette;

/** Two letters of a name, or four digits of a number, as the client search asks. */
const searchable = (text: string): boolean => /\p{L}.*\p{L}/u.test(text) || text.replace(/\D/g, "").length >= 4;

interface Place {
  readonly key: string;
  readonly name: string;
  readonly to: string;
}

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

/** The technicians, read once as the palette opens, for those who may read the roster. */
function useTechnicians(mayRead: boolean): readonly { readonly id: string; readonly name: string }[] {
  const [technicians, setTechnicians] = useState<readonly { readonly id: string; readonly name: string }[]>([]);
  useEffect(() => {
    if (!mayRead) return;
    let current = true;
    void api.roster().then((answer) => {
      if (current && answer.ok) setTechnicians([...answer.body.technicians, ...answer.body.switched_off]);
    });
    return () => {
      current = false;
    };
  }, [mayRead]);
  return technicians;
}

/** The arrow keys through the places found: down from the box into them, up out of the first back to it. */
function moveThrough(
  event: Pick<KeyboardEvent, "key" | "preventDefault">,
  list: HTMLElement | null,
  box: HTMLInputElement | null,
): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const links = [...(list?.querySelectorAll<HTMLElement>("a") ?? [])];
  const at = links.indexOf(document.activeElement as HTMLElement);
  event.preventDefault();
  if (event.key === "ArrowDown") links[Math.min(at + 1, links.length - 1)]?.focus();
  else if (at <= 0) box?.focus();
  else links[at - 1]?.focus();
}

/** What the words find, in the order the palette lists them: the clients opened this session before anything is
 * typed, then the pages, then technicians, then clients. */
function usePlaces(text: string): Place[] {
  const mayCall = useMayCall();
  const access = useAccess();
  const asked = text.trim().toLowerCase();
  const pages: Place[] = [
    ...SECTIONS.filter((each) => mayOpen(mayCall, each.page)).map((each) => ({
      key: each.page,
      name: SECTION_NAMES[each.page],
      to: each.path,
    })),
    ...SETTINGS_PAGES.filter((each) => mayOpenSetting(mayCall, each.tab)).map((each) => ({
      key: `settings ${each.tab}`,
      name: words.setting(SETTINGS_PAGE_NAMES[each.tab]),
      to: settingsPath(each.tab),
    })),
  ].filter((place) => place.name.toLowerCase().includes(asked));
  const technicians: Place[] = useTechnicians(access.mayCall("GET /api/technicians"))
    .filter((each) => asked !== "" && each.name.toLowerCase().includes(asked))
    .map((each) => ({ key: `technician ${each.id}`, name: words.technician(each.name), to: technicianPath(each.id) }));
  const clients: Place[] = useClients(text, access.mayCall("POST /api/clients/find")).map((each) => ({
    key: each.id,
    name: words.client(each.name, phoneWords(each.mobile)),
    to: clientPath(each.id, "history"),
  }));
  const recent: Place[] =
    asked === ""
      ? recentClients().map((each) => ({
          key: `recent ${each.id}`,
          name: words.recent(each.name),
          to: clientPath(each.id, "history"),
        }))
      : [];
  return [...recent, ...pages, ...technicians, ...clients];
}

function Palette({ onClose }: { onClose: () => void }) {
  const list = useRef<HTMLUListElement>(null);
  const [text, setText] = useState("");
  // Once the dialog has taken the keyboard to read out its name, the box takes it, so typing searches at once.
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  const places = usePlaces(text);
  // The arrow keys move between the places found as they do from the box, up out of the first back into it.
  useEffect(() => {
    const found = list.current;
    const move = (event: KeyboardEvent) => {
      moveThrough(event, found, box.current);
    };
    found?.addEventListener("keydown", move);
    return () => {
      found?.removeEventListener("keydown", move);
    };
  }, [places.length]);
  return (
    <Dialog className={styles.palette} labelledBy="palette-title" canClose onDismiss={onClose}>
      <h2 className={typeLook("title-3", styles.title)} id="palette-title">
        {words.title}
      </h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (places[0] === undefined) return;
          onClose();
          go(places[0].to);
        }}
      >
        <Field label={words.label}>
          {(control) => (
            <TextInput
              {...control}
              ref={box}
              autoComplete="off"
              onKeyDown={(event) => {
                moveThrough(event, list.current, box.current);
              }}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          )}
        </Field>
      </form>
      {places.length === 0 ? (
        <p className={styles.none}>{words.none}</p>
      ) : (
        <ul ref={list} className={styles.places} aria-label={words.found}>
          {places.map((place) => (
            <li key={place.key}>
              <Link className={textLinkLook({ className: styles.place })} to={place.to}>
                {place.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/** The palette, opened by Ctrl K or ⌘K anywhere in the console, or by the frame's Search. */
export function CommandPalette({
  open,
  onOpen,
  onClose,
}: {
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}) {
  // A place chosen opens its page, and the palette closes with the page it was opened over.
  const path = usePath();
  useEffect(() => {
    onClose();
  }, [path, onClose]);
  useEffect(() => {
    const opens = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", opens);
    return () => {
      window.removeEventListener("keydown", opens);
    };
  }, [onOpen]);
  if (!open) return null;
  return <Palette onClose={onClose} />;
}
