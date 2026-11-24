// The client a task written by hand is about (./NewTask.tsx): found by name or number, Enter or Find searching, and
// chosen; Change puts the search back. The keyboard follows each step, so it is never left on a button gone.

import { focusIfLost } from "@maneman/ui/arrival";
import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { useEffect, useState } from "react";
import { api, type ClientsFound } from "../api.ts";
import { tasks } from "../content.ts";
import styles from "./task-actions.module.css";
import form from "@maneman/ui/forms.module.css";

const copy = tasks.write;
const CHANGE_ID = "new-task-change";
const BOX_ID = "new-task-client";

export type Found = ClientsFound["clients"][number];

/** Two letters of a name, or four digits of a number, as the client search asks. */
const searchable = (text: string): boolean => /\p{L}.*\p{L}/u.test(text) || text.replace(/\D/g, "").length >= 4;

/** The client chosen, and Change, which puts the search back. */
function Chosen(props: { client: Found; busy: boolean; failure: Failure | null; onChange: () => void }) {
  return (
    <Field label={copy.client} error={boxError(copy.errors, props.failure, "client")}>
      {() => (
        <p className={styles.chosen}>
          {copy.chosen(props.client.name, props.client.mobile)}{" "}
          <Button id={CHANGE_ID} variant="outline" size="small" disabled={props.busy} onClick={props.onChange}>
            {copy.change}
          </Button>
        </p>
      )}
    </Field>
  );
}

type Search = readonly Found[] | "failed" | "short" | null;

/** What the search found: each client with Choose, or that none was, or why it did not search. */
function Results(props: { found: Search; onChoose: (client: Found) => void }) {
  const { found } = props;
  if (found === null) return null;
  // Said once the search is pressed, so a screen reader reads it out.
  if (found === "short") return <Note role="status">{copy.tooShort}</Note>;
  if (found === "failed") return <Note role="status">{copy.searchFailed}</Note>;
  if (found.length === 0) return <Note role="status">{copy.noneFound}</Note>;
  return (
    <ul className={styles.found}>
      {found.map((client) => (
        <li key={client.id}>
          {copy.chosen(client.name, client.mobile)}{" "}
          <Button
            variant="outline"
            size="small"
            aria-label={copy.chooseLabel(client.name)}
            onClick={() => {
              props.onChoose(client);
            }}
          >
            {copy.choose}
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function ClientChoice(props: {
  chosen: Found | null;
  busy: boolean;
  failure: Failure | null;
  onChoose: (client: Found | null) => void;
}) {
  const [text, setText] = useState("");
  const [found, setFound] = useState<Search>(null);
  // The button pressed goes as the client is chosen or let go: the keyboard goes to what takes its place.
  useEffect(() => {
    focusIfLost(
      props.chosen === null
        ? document.querySelector<HTMLElement>(`#${BOX_ID} input`)
        : document.getElementById(CHANGE_ID),
    );
  }, [props.chosen]);
  if (props.chosen !== null)
    return (
      <Chosen
        client={props.chosen}
        busy={props.busy}
        failure={props.failure}
        onChange={() => {
          props.onChoose(null);
        }}
      />
    );
  const find = async () => {
    if (!searchable(text)) {
      setFound("short");
      return;
    }
    const answer = await api.findClients(text.trim());
    setFound(answer.ok ? answer.body.clients : "failed");
  };
  return (
    <>
      <div id={BOX_ID} className={form.wide}>
        <Field label={copy.client} error={boxError(copy.errors, props.failure, "client")}>
          {(control) => (
            // Find beside the box it searches, level with it whatever is said beneath.
            <div className={styles.find}>
              <TextInput
                {...control}
                maxLength={60}
                placeholder={copy.findPlaceholder}
                value={text}
                disabled={props.busy}
                onChange={(event) => {
                  setText(event.target.value);
                }}
                onKeyDown={(event) => {
                  // Enter searches, rather than adding the task without its client.
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  void find();
                }}
              />
              <Button variant="outline" size="control" onClick={() => void find()}>
                {copy.find}
              </Button>
            </div>
          )}
        </Field>
      </div>
      <Results found={found} onChoose={props.onChoose} />
    </>
  );
}
