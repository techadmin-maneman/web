// Who is signed in, at the header's right where the design draws "AK" in a box,
// and the way out, which the board does not draw.

import { useLoad } from "@maneman/ui/useLoad";
import { shell } from "../content.ts";
import { whoami } from "../lib/access.ts";
import { forgetClients } from "../lib/client-search.ts";
import { whoWords } from "../lib/who.ts";
import styles from "./shell.module.css";

/** "aditya.kumar@maneman.in" reads "AK", and "ops@maneman.in" "OP", as the board's box holds two letters. */
function initialsOf(who: string): string {
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
      <span>{shell.account.signedInAs(whoWords(who))}</span>
      <span className={styles.initials} aria-hidden="true">
        {initialsOf(who)}
      </span>
      {signOut !== null && (
        <a className={styles.signOut} href={signOut} onClick={forgetClients}>
          {shell.account.signOut}
        </a>
      )}
    </div>
  );
}
