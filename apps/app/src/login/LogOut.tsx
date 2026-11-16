// Logging out, at the foot of the profile, drawn as the list's rows above it are. Only the API can end the session:
// a phone that forgot it without the API's answer would come back signed in on
// the next open, which on a shared phone is someone else's. So the button waits
// for a connection, and says so when the API does not answer.

import { CLIENT_ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { classes } from "@maneman/ui/classes";
import { Icon } from "@maneman/ui/Icon";
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
        variant="quiet"
        size="control"
        className={classes(styles.row, className)}
        disabled={offline || busy}
        onClick={() =>
          void once(async () => {
            setFailed(!(await logOut()));
          })
        }
      >
        <Icon className={styles.icon} d={CLIENT_ICONS.logout} size="lg" />
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
