// Who is signed in, at the header's right where board A1 draws "AK" in a box,
// and the way out, which the board does not draw. Asked for once per load of
// the console, since the frame is drawn afresh on every page.

import { useLoad } from "@maneman/ui/useLoad";
import { api, type Answer, type Whoami } from "../api.ts";
import { shell } from "../content.ts";
import styles from "./shell.module.css";

let asked: Promise<Answer<Whoami>> | null = null;

/** The one answer for this load of the console; a failed one is asked again on the next page. */
export function whoami(): Promise<Answer<Whoami>> {
  asked ??= api.whoami().then((answer) => {
    if (!answer.ok) asked = null;
    return answer;
  });
  return asked;
}

/** "aditya.kumar@maneman.in" reads "AK", and "ops@maneman.in" "OP", as the board's box holds two letters. */
export function initialsOf(who: string): string {
  const name = who.split("@")[0] ?? who;
  const [first = "", second = ""] = name.split(/[._-]+/).filter((part) => part !== "");
  const letters = second === "" ? first.slice(0, 2) : `${first.slice(0, 1)}${second.slice(0, 1)}`;
  return letters.toUpperCase();
}

export function Account() {
  const [loaded] = useLoad(whoami);
  if (loaded.state !== "loaded") return null;
  const { signed_in_as: who, sign_out: signOut } = loaded.value;
  return (
    <div className={styles.account}>
      <span>{shell.account.signedInAs(who)}</span>
      <span className={styles.initials} aria-hidden="true">
        {initialsOf(who)}
      </span>
      {signOut !== null && (
        <a className={styles.signOut} href={signOut}>
          {shell.account.signOut}
        </a>
      )}
    </div>
  );
}
