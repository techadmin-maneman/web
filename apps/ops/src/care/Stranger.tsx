// A chat from a number we don't know (docs/decisions/0138-strangers-in-the-inbox.md): Care find the client it turns
// out to be and link it, or save the person as someone new by the name they gave. Either way the chat becomes theirs.

import { Button, RowButton } from "@maneman/ui/Button";
import { Field, Select, TextInput } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { api, type ClientsFound } from "../api.ts";
import { care } from "../content/care.ts";
import { Refused } from "@maneman/ui/Refusal";
import { HEARD_FROM } from "@rules/policy/heard-from.ts";
import { careApi, type HeardFrom } from "./care-api.ts";
import form from "@maneman/ui/forms.module.css";
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
        <Field label={copy.find} error={boxError(copy.errors, failure, "person_id")}>
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
      {found !== null && found.length === 0 && <Note>{copy.noneFound}</Note>}
      {found !== null && found.length > 0 && (
        <ul className={styles.leave}>
          {found.map((client) => (
            <li key={client.id}>
              {copy.client(client.name, client.mobile)}{" "}
              <RowButton beside aria-label={copy.linkLabel(client.name)} onClick={() => void link(client.id)}>
                {copy.link}
              </RowButton>
            </li>
          ))}
        </ul>
      )}
      <Refused failed={failure} errors={copy.errors} boxes={["person_id"]} />
    </div>
  );
}

function SaveAsNew(props: { conversationId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [heardFrom, setHeardFrom] = useState<HeardFrom | "">("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const save = async () => {
    setFailure(null);
    const answer = await careApi.saveStranger(
      props.conversationId,
      name.trim(),
      heardFrom === "" ? undefined : heardFrom,
    );
    if (answer.ok) props.onDone();
    else setFailure({ code: answer.code, fields: answer.fields });
  };
  return (
    <div className={styles.stranger}>
      <div className={styles.closing}>
        <Field label={copy.name} error={boxError(copy.errors, failure, "name")}>
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
        <Field label={copy.heardFrom} error={boxError(copy.errors, failure, "heard_from")}>
          {(control) => (
            <Select
              {...control}
              width="choice"
              value={heardFrom}
              onChange={(event) => {
                setHeardFrom(HEARD_FROM.find((each) => each.code === event.target.value)?.code ?? "");
              }}
            >
              <option value="">{copy.didNotSay}</option>
              {HEARD_FROM.map((each) => (
                <option key={each.code} value={each.code}>
                  {each.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button variant="outline" size="small" disabled={name.trim() === ""} onClick={() => void save()}>
          {copy.save}
        </Button>
      </div>
      <Refused failed={failure} errors={copy.errors} boxes={["name", "heard_from"]} />
    </div>
  );
}

export function Stranger(props: { readonly conversationId: string; readonly onDone: () => void }) {
  return (
    <section className={form.group} aria-label={copy.title}>
      <Note>{copy.title}</Note>
      <FindAndLink conversationId={props.conversationId} onDone={props.onDone} />
      <SaveAsNew conversationId={props.conversationId} onDone={props.onDone} />
    </section>
  );
}
