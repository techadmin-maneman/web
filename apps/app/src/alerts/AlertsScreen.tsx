// The alerts under the bell (design/client-redesign, the notifications screen; docs/decisions/0255-client-alerts-and-
// push.md): today's, then the earlier ones, newest first, each opening what it is about. Opening the inbox marks them
// read, so the bell clears; the ones that were new stay marked so while the page is open.

import { GLYPHS } from "@maneman/brand/icons";
import { Badge } from "@maneman/ui/Badge";
import { EmptyState } from "@maneman/ui/EmptyState";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { Loading } from "@maneman/ui/States";
import { textLinkLook } from "@maneman/ui/TextLink";
import { useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { apiNow } from "@maneman/web-kit/clock";
import { dayMonth, indiaClock, indiaDate, todayInIndia } from "@maneman/web-kit/dates";
import { useEffect, useRef } from "react";
import { api, type ClientAlert as Alert } from "../api.ts";
import { alerts, alertWords, profile, titles } from "../content.ts";
import { PageFailed } from "../frame/PageFailed.tsx";
import { AppLink, Shell } from "../frame/Shell.tsx";
import { useSession } from "../session.ts";
import { PhoneAlerts } from "./PhoneAlerts.tsx";
import styles from "./alerts.module.css";

/** "3:42 pm" today; "14 Nov, 3:42 pm" before. */
const stamp = (at: string, today: string) =>
  indiaDate(at) === today ? indiaClock(at) : `${dayMonth(indiaDate(at))}, ${indiaClock(at)}`;

function Group({ label, list, today }: { label: string; list: readonly Alert[]; today: string }) {
  if (list.length === 0) return null;
  return (
    <section aria-label={label}>
      <h2 className={styles.group}>{label}</h2>
      <ListRows>
        {list.map((alert) => {
          const words = alertWords(alert);
          return (
            <ListRow
              key={alert.id}
              title={words.title}
              meta={`${words.line} · ${stamp(alert.at, today)}`}
              end={alert.read ? undefined : <Badge tone="attention">{alerts.unread}</Badge>}
              to={words.to}
            />
          );
        })}
      </ListRows>
    </section>
  );
}

function Inbox({ list, pushKey }: { list: readonly Alert[]; pushKey: string | null }) {
  const today = todayInIndia(apiNow());
  return (
    <div className={styles.page}>
      <PhoneAlerts pushKey={pushKey} />
      {list.length === 0 && <EmptyState look="page" lines={alerts.none} icon={GLYPHS.bell} />}
      <Group label={alerts.today} list={list.filter((alert) => indiaDate(alert.at) === today)} today={today} />
      <Group label={alerts.earlier} list={list.filter((alert) => indiaDate(alert.at) !== today)} today={today} />
      <p className={styles.note}>
        {alerts.whatsapp}{" "}
        <AppLink className={textLinkLook({ inline: true })} to="/profile/privacy">
          {alerts.privacy}
        </AppLink>
        .
      </p>
    </div>
  );
}

export function AlertsScreen() {
  const session = useSession();
  const refresh = useRef(session.refresh);
  refresh.current = session.refresh;
  const [loaded, retry] = useLoad(api.alerts);
  const opened = loaded.state === "loaded";
  useEffect(() => {
    if (!opened) return;
    void api.readAlerts().then((answer) => {
      // Home is read again, so the bell's count is the inbox's.
      if (answer.ok) refresh.current();
    });
  }, [opened]);
  return (
    <Shell header={{ kind: "back", title: titles.alerts, to: "/", label: profile.back }} tab={null}>
      {whenLoaded(loaded, {
        loading: <Loading />,
        failed: <PageFailed onRetry={retry} />,
        loaded: ({ alerts: list, push_key: pushKey }) => <Inbox list={list} pushKey={pushKey} />,
      })}
    </Shell>
  );
}
