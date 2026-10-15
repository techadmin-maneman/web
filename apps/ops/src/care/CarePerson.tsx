// A client's Care person in their chat (docs/decisions/0131-care-people.md): who looks after them, and for a Customer
// Care manager, moving them to another of the team.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Button } from "@maneman/ui/Button";
import { Field, Select } from "@maneman/ui/Field";
import { Note } from "@maneman/ui/Note";
import { useLoad } from "@maneman/ui/useLoad";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import { useAccess } from "../lib/access.ts";
import { care as copy } from "../content/care.ts";
import { Refused } from "../settings/index.ts";
import { careApi, type CareMember } from "./care-api.ts";
import form from "../components/forms.module.css";
import styles from "./care.module.css";

const { carePerson: words } = copy;

function MoveTo(props: {
  readonly personId: string;
  readonly team: readonly CareMember[];
  readonly now: string | null;
  readonly onMoved: (email: string) => void;
}) {
  const [email, setEmail] = useState(props.now ?? props.team[0]?.email ?? "");
  const [busy, once] = useOneAtATime();
  const [failure, setFailure] = useState<Failure | null>(null);
  const move = () =>
    once(async () => {
      setFailure(null);
      const answer = await careApi.moveCarePerson(props.personId, email);
      if (answer.ok) props.onMoved(answer.body.care_person);
      else setFailure({ code: answer.code, fields: answer.fields });
    });
  return (
    <div className={styles.closing}>
      <Field label={words.moveTo} error={boxError(words.errors, failure, "email")}>
        {(control) => (
          <Select
            {...control}
            width="choice"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          >
            {props.team.map((member) => (
              <option key={member.email} value={member.email}>
                {words.member(member.email, member.clients)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button
        variant="outline"
        size="small"
        narrow
        disabled={busy || email === "" || email === props.now}
        onClick={() => void move()}
      >
        {busy ? words.moving : words.move}
      </Button>
      <Refused failed={failure} errors={words.errors} boxes={["email"]} />
    </div>
  );
}

function Team(props: {
  readonly personId: string;
  readonly now: string | null;
  readonly onMoved: (email: string) => void;
}) {
  const load = useCallback(() => careApi.careTeam(), []);
  const [loaded] = useLoad(load);
  if (loaded.state !== "loaded") return null;
  if (loaded.value.team.length === 0) return <Note>{words.noTeam}</Note>;
  return <MoveTo personId={props.personId} team={loaded.value.team} now={props.now} onMoved={props.onMoved} />;
}

/** The Care person, and who covers them while they are off, until a manager moves the client. */
const coveredOf = (now: string, was: string | null, cover: string | null): string =>
  cover !== null && now === was ? copy.coveredBy(now, cover) : now;

export function CarePerson(props: {
  readonly personId: string;
  readonly email: string | null;
  /** Who covers them today, while they are off. */
  readonly coveredBy: string | null;
}) {
  const [now, setNow] = useState(props.email);
  const [said, setSaid] = useState<string | null>(null);
  const mayMove = useAccess().mayCall("POST /api/clients/{id}/care-person");
  return (
    <div className={styles.carePerson}>
      <Note>
        {words.label}: {now === null ? words.none : coveredOf(now, props.email, props.coveredBy)}
      </Note>
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
      {mayMove && (
        <Team
          personId={props.personId}
          now={now}
          onMoved={(email) => {
            setNow(email);
            setSaid(words.moved(email));
          }}
        />
      )}
    </div>
  );
}
