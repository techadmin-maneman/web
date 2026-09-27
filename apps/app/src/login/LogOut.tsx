// Logging out, at the foot of the profile. Only the API can end the session:
// a phone that forgot it without the API's word would come back signed in on
// the next open, which on a shared phone is someone else's. So the button waits
// for a connection, and says so when the API does not answer.

import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { profile } from "../content.ts";
import { useSession } from "../session.ts";
import styles from "./logout.module.css";

export function LogOut({ className }: { className?: string }) {
  const { offline, logOut } = useSession();
  const [busy, once] = useOneAtATime();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="control"
        className={className}
        disabled={offline || busy}
        onClick={() =>
          void once(async () => {
            setFailed(!(await logOut()));
          })
        }
      >
        {profile.logout}
      </Button>
      {failed && (
        <p className={styles.problem} role="alert">
          {profile.logoutFailed}
        </p>
      )}
    </>
  );
}
