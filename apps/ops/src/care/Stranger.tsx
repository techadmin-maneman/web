// A chat from a number we don't know (docs/decisions/0138-strangers-in-the-inbox.md): Care find the client it turns
// out to be and link it, or save the person as someone new by the name they gave. Either way the chat becomes theirs.

import { Button, RowButton } from "@maneman/ui/Button";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import type { Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { api, type ClientsFound } from "../api.ts";
import { care } from "../content/care.ts";
import { Refused } from "../settings/index.ts";
import { careApi, type FoundUs } from "./care-api.ts";
import form from "../components/forms.module.css";
import styles from "./care.module.css";

const copy = care.stranger;

/** Two letters of a name, or four digits of a number, as the client search asks. */
const searchable = (text: string): boolean => /\p{L}.*\p{L}/u.test(text) || text.replace(/\D/g, "").length >= 4;

function FindAndLink(props: { conversationId: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [found, setFound] = useState<ClientsFound["clients"] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const failed = (answer: { code: string; fields?: readonly string[] }) => {
    setFailure({ code: answer.code, fields: answer.fields });
  };
  const find = async () => {
    setFailure(null);
    const answer = await api.findClients(text.trim());
    if (answer.ok) setFound(answer.body.clients);
    else failed(answer);
  };
  const link = async (personId: string) => {
    setFailure(null);
    const answer = await careApi.linkChat(props.conversationId, personId);
    if (answer.ok) props.onDone();
    else failed(answer);
  };
  return (
    <div className={styles.stranger}>
      <div className={styles.closing}>
        <Field label={copy.find}>
          {(control) => (
            <TextInput
              {...control}
              maxLength={60}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          )}
        </Field>
        <Button variant="outline" size="small" disabled={!searchable(text)} onClick={() => void find()}>
          {copy.search}
        </Button>
      </div>
      {found !== null && found.length === 0 && <p className={form.note}>{copy.noneFound}</p>}
      {found !== null && found.length > 0 && (
        <ul className={styles.leave}>
          {found.map((client) => (
            <li key={client.id}>
              {copy.client(client.name, client.mobile)}{" "}
              <RowButton
                className={form.inline}
                aria-label={copy.linkLabel(client.name)}
                onClick={() => void link(client.id)}
              >
                {copy.link}
              </RowButton>
            </li>
          ))}
        </ul>
      )}
      <Refused failed={failure} errors={copy.errors} />
    </div>
  );
}

function SaveAsNew(props: { conversationId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [foundUs, setFoundUs] = useState<FoundUs | "">("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const save = async () => {
    setFailure(null);
    const answer = await careApi.saveStranger(props.conversationId, name.trim(), foundUs === "" ? undefined : foundUs);
    if (answer.ok) props.onDone();
    else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <div className={styles.stranger}>
      <div className={styles.closing}>
        <Field label={copy.name}>
          {(control) => (
            <TextInput
              {...control}
              maxLength={80}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={copy.foundUs}>
          {(control) => (
            <Select
              {...control}
              className={form.choiceBox}
              value={foundUs}
              onChange={(event) => {
                setFoundUs(event.target.value as FoundUs | "");
              }}
            >
              {Object.entries(copy.foundUsChoices).map(([code, words]) => (
                <option key={code} value={code}>
                  {words}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button variant="outline" size="small" disabled={name.trim() === ""} onClick={() => void save()}>
          {copy.save}
        </Button>
      </div>
      <Refused failed={failure} errors={copy.errors} />
    </div>
  );
}

export function Stranger(props: { readonly conversationId: string; readonly onDone: () => void }) {
  return (
    <section className={form.group} aria-label={copy.title}>
      <p className={form.note}>{copy.title}</p>
      <FindAndLink conversationId={props.conversationId} onDone={props.onDone} />
      <SaveAsNew conversationId={props.conversationId} onDone={props.onDone} />
    </section>
  );
}
