// A client's Care person beside their chat (docs/decisions/0131-care-people.md): who looks after them, among the
// client's facts, and for a Customer Care manager, moving them to another of the team.

import { Toast } from "@maneman/ui/Toast";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { Button } from "@maneman/ui/Button";
import { Field, Select } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { boxError, type Failure } from "@maneman/web-kit/refusal";
import { useCallback, useState } from "react";
import { useAccess } from "../lib/access.ts";
import { care as copy } from "../content/care.ts";
import { Refused } from "@maneman/ui/Refusal";
import { careApi, type CareMember } from "./care-api.ts";
import styles from "./care.module.css";

const { carePerson: words } = copy;

/** A Care person by e-mail, and the first name clients know them by once a manager has set one. */
export interface Named {
  readonly email: string;
  readonly name: string | null;
}
/** By the first name clients know them by, where one is set; by e-mail until then. */
const nameOf = (person: Named) => person.name ?? person.email;

function MoveTo(props: {
  readonly personId: string;
  readonly team: readonly CareMember[];
  readonly now: string | null;
  readonly onMoved: (moved: Named) => void;
}) {
  const [email, setEmail] = useState(props.now ?? props.team[0]?.email ?? "");
  const [busy, once] = useOneAtATime();
  const [failure, setFailure] = useState<Failure | null>(null);
  const move = () =>
    once(async () => {
      setFailure(null);
      const answer = await careApi.moveCarePerson(props.personId, email);
      if (!answer.ok) {
        setFailure({ code: answer.code, fields: answer.fields });
        return;
      }
      const moved = answer.body.care_person;
      props.onMoved({ email: moved, name: props.team.find((member) => member.email === moved)?.name ?? null });
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
                {words.member(member.name ?? member.email)}
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
  readonly onMoved: (moved: Named) => void;
}) {
  const load = useCallback(() => careApi.careTeam(), []);
  const [loaded] = useLoad(load);
  if (loaded.state !== "loaded") return null;
  if (loaded.value.team.length === 0) return null;
  return <MoveTo personId={props.personId} team={loaded.value.team} now={props.now} onMoved={props.onMoved} />;
}

/** The Care person as the facts beside a chat give them: who covers them while they are off, or none given yet. */
export function careWords(now: Named | null, was: string | null, cover: string | null): string {
  if (now === null) return words.none;
  return cover !== null && now.email === was ? copy.coveredBy(nameOf(now), cover) : nameOf(now);
}

/** For a Customer Care manager, moving the client to another of the team; said once moved. */
export function CareMove(props: {
  readonly personId: string;
  readonly now: Named | null;
  readonly onMoved: (moved: Named) => void;
}) {
  const [said, setSaid] = useState<string | null>(null);
  const mayMove = useAccess().mayCall("POST /api/clients/{id}/care-person");
  if (!mayMove) return null;
  return (
    <>
      {said !== null && <Toast>{said}</Toast>}
      <Team
        personId={props.personId}
        now={props.now?.email ?? null}
        onMoved={(moved) => {
          props.onMoved(moved);
          setSaid(words.moved(nameOf(moved)));
        }}
      />
    </>
  );
}
