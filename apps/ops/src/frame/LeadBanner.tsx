// A lead who wrote to us and waits past their alert time for Care's first reply, on every console screen of a Care
// person on shift (docs/decisions/0323-the-unanswered-lead-alert.md): the longest waiting, how many wait, and the way to
// their chat. Read again every half minute, as the SOS banner is, in its shape but the attention colour; it goes once
// Care reply.

import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { buttonLook } from "@maneman/ui/Button";
import { rowPath } from "@maneman/ui/target";
import { indiaClock, indiaDate, shortDate, todayInIndia } from "@maneman/web-kit/dates";
import { apiNow } from "@maneman/web-kit/clock";
import { useEffect, useState } from "react";
import { api, type WaitingLead } from "../api.ts";
import { shell } from "../content/shell.ts";
import { useAccess, useAccessSettled } from "../lib/access.ts";
import { keepLeadAlerts, notificationsHere } from "../lib/lead-push.ts";
import { phoneWords } from "../lib/phone.ts";
import { OpsLink } from "./Shell.tsx";
import styles from "./sos-banner.module.css";

const copy = shell.leads;

/** How often the banner asks again: a lead must reach a screen left open within the minute. */
const READ_EVERY_MS = 30_000;

/** Whether this page has given the device's subscription again: once a load. */
let kept = false;

/** A device whose lead alerts are on gives its subscription again, so an address the browser renewed reaches us. */
function keepOnce(key: string | null) {
  if (kept || key === null || notificationsHere() !== "on") return;
  kept = true;
  keepLeadAlerts(key).catch(() => undefined);
}

/**
 * When the wait began: the time today, else the day too, as a message at 10 pm is read at 9:30 the next morning; the
 * day and the time each kept whole on one line.
 */
function sinceWords(since: string): string {
  const day = indiaDate(since);
  const time = indiaClock(since).replace(" ", "\u00a0");
  return day === todayInIndia(apiNow()) ? time : `${shortDate(day).replaceAll(" ", "\u00a0")}, ${time}`;
}

export function LeadBanner() {
  const access = useAccess();
  const mayRead = useAccessSettled() && access.mayCall("GET /api/leads/waiting");
  const [leads, setLeads] = useState<readonly WaitingLead[]>([]);
  useEffect(() => {
    // Only for Customer Care, and drawn only for whoever is on shift.
    if (!mayRead) return undefined;
    const ask = () => {
      api
        .waitingLeads()
        .then((answer) => {
          if (!answer.ok) return;
          setLeads(answer.body.on_shift ? answer.body.leads : []);
          keepOnce(answer.body.push_key);
        })
        .catch(() => undefined);
    };
    ask();
    const timer = setInterval(ask, READ_EVERY_MS);
    return () => {
      clearInterval(timer);
    };
  }, [mayRead]);
  const first = leads[0];
  if (first === undefined) return null;
  return (
    <div className={styles.banner}>
      <div className={`${styles.sos} ${styles.attention}`} role="status">
        <div className={styles.what}>
          <p className={styles.title}>{copy.title(leads.length, sinceWords(first.since))}</p>
          <p className={styles.line}>{copy.wrote(first.name, phoneWords(first.mobile))}</p>
        </div>
        <div className={styles.actions}>
          <OpsLink
            to={rowPath("/messages", "chat", first.conversation_id)}
            className={buttonLook({ variant: "primary", size: "small", iconOnly: true })}
            icon={ACTION_ICONS.arrowUpRight}
          >
            {copy.openChat}
          </OpsLink>
        </div>
      </div>
    </div>
  );
}
