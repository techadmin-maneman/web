// Alerts (docs/prompts/tech-redesign.md, "Alerts"), from Today's bell and from Me: the inbox, newest first, each opening
// its job, marked read once seen; Send me, the kinds on; and, where the phone can show them and has not been allowed
// to, the way to turn notifications on.

import { TextButton } from "@maneman/ui/TextLink";
import { dataChanged, useLoad } from "@maneman/ui/useLoad";
import { useEffect, useState } from "react";
import { api, type AlertSettings, type Alerts } from "../api.ts";
import { alerts as copy } from "../content.ts";
import { CardFrame } from "../frame/CardFrame.tsx";
import { Failed, Loading } from "../frame/States.tsx";
import { apiDate } from "../lib/when.ts";
import { AlertList, SendMe, type AlertKind } from "./AlertList.tsx";
import { linesOf } from "./lines.ts";
import { notificationsHere, turnOnNotifications, type OnThisPhone } from "./push.ts";
import styles from "./alerts.module.css";

export function AlertsScreen({ back }: { readonly back: string }) {
  const [loaded, retry] = useLoad(api.alerts);
  return (
    <CardFrame title={copy.title} sub={copy.sub} back={back} foot={null}>
      {loaded.state === "loaded" && <Inbox alerts={loaded.value} />}
      {loaded.state === "loading" && <Loading onPaper />}
      {loaded.state === "failed" && (
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={loaded.requestId} onPaper />
      )}
    </CardFrame>
  );
}

function Inbox({ alerts }: { readonly alerts: Alerts }) {
  const lines = linesOf(alerts.alerts, apiDate());
  const [settings, setSettings] = useState<AlertSettings>(alerts.settings);
  const [failed, setFailed] = useState(false);
  const unread = alerts.alerts.some((alert) => !alert.read);

  // Seen, so read: the bell's count goes once the API has them as read.
  useEffect(() => {
    if (!unread) return;
    void api.alertsRead().then((answer) => {
      if (answer.ok) dataChanged();
    });
  }, [unread]);

  const toggle = async (kind: AlertKind) => {
    const answer = await api.alertSettings({ [kind]: !settings[kind] });
    setFailed(!answer.ok);
    if (answer.ok) setSettings(answer.body);
  };

  return (
    <>
      <AlertList lines={lines} />
      <SendMe
        on={settings}
        notice={{ leaveMinutes: alerts.leave_notice_min, dayAheadHour: alerts.day_ahead_hour }}
        onToggle={(kind) => void toggle(kind)}
        failed={failed}
      />
      {alerts.push_key !== null && <OnPhone pushKey={alerts.push_key} />}
    </>
  );
}

/** Whether this phone shows the alerts: the way to turn them on, or that the phone's settings block them. */
function OnPhone({ pushKey }: { readonly pushKey: string }) {
  const [here, setHere] = useState<OnThisPhone>(notificationsHere);
  if (here === "unsupported" || here === "on") return null;
  if (here === "blocked") return <p className={styles.phone}>{copy.blocked}</p>;
  return (
    <p className={styles.phone} role={here === "failed" ? "alert" : undefined}>
      {here === "failed" ? copy.turnOnFailed : copy.phoneOff}{" "}
      <TextButton
        onClick={() => {
          void turnOnNotifications(pushKey).then(setHere);
        }}
      >
        {copy.turnOn}
      </TextButton>
    </p>
  );
}
