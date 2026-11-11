// Today's bell (docs/prompts/tech-redesign.md, "Today"): the way to Alerts, with how many are new, read again as Today
// is. Where this phone has allowed notifications, its subscription is given to the API again once a session, so an
// address the browser renewed reaches it.

import { GLYPHS } from "@maneman/brand/icons";
import { IconLink } from "@maneman/ui/IconLink";
import { useLoad } from "@maneman/ui/useLoad";
import { useEffect } from "react";
import { api } from "../api.ts";
import { alerts as copy } from "../content.ts";
import { keepSubscription, notificationsHere } from "./push.ts";
import styles from "./alerts.module.css";

let keptThisSession = false;

export function Bell() {
  const [loaded] = useLoad(api.alerts);
  const alerts = loaded.state === "loaded" ? loaded.value : null;
  const unread = alerts?.alerts.filter((alert) => !alert.read).length ?? 0;
  const pushKey = alerts?.push_key ?? null;

  useEffect(() => {
    if (pushKey === null || keptThisSession || notificationsHere() !== "on") return;
    keptThisSession = true;
    void keepSubscription(pushKey).catch(() => {
      keptThisSession = false;
    });
  }, [pushKey]);

  return (
    <IconLink className={styles.bell} to="/alerts" d={GLYPHS.bell} size="md" label={copy.bell(unread)} count={unread} />
  );
}
