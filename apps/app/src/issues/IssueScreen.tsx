// One issue (design/client-redesign, the issue screen; docs/decisions/0259-the-issue-log.md): where it stands, what it
// is and when it was raised, the visit it is about, and its log, with what is still waited on. A report takes the
// client's update, their word that it is sorted, and, once resolved, its reopening, each into the same log; a grievance
// or a dispute is answered by its own process, so its page only reads.

import { CLIENT_ICONS } from "@maneman/brand/icons";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { Loading } from "@maneman/ui/States";
import { Timeline, type TimelineItem, type TimelineTone } from "@maneman/ui/Timeline";
import { useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { dayMonth, indiaClock, indiaDate } from "@maneman/web-kit/dates";
import { api, type Issue } from "../api.ts";
import { issues, profile, titles } from "../content.ts";
import { PageFailed } from "../frame/PageFailed.tsx";
import { Shell } from "../frame/Shell.tsx";
import { useSession } from "../session.ts";
import { IssueState, issueTitle } from "../visits/index.ts";
import { IssueActions } from "./IssueActions.tsx";
import styles from "./issue.module.css";

/** "14 Nov, 3:42 pm". */
const stamp = (at: string) => `${dayMonth(indiaDate(at))}, ${indiaClock(at)}`;

/** A line's dot: the client's own ringed, the end of it in green, everything of ours filled. */
function toneOf(kind: Issue["events"][number]["kind"]): TimelineTone {
  if (kind === "closed" || kind === "sorted") return "done";
  return kind === "you" ? "theirs" : "ours";
}

/** The log's lines, and the one still waited on while the issue is open. */
function logOf(issue: Issue, waiting: string): TimelineItem[] {
  const lines = issue.events.map((event, index): TimelineItem => ({
    key: String(index),
    when: stamp(event.at),
    who: issues.who(event),
    text:
      event.kind === "ruled" && event.text !== null
        ? (issues.ruled[event.text] ?? event.text)
        : (event.text ?? undefined),
    tone: toneOf(event.kind),
  }));
  if (issue.state === "resolved") return lines;
  return [...lines, { key: "waiting", who: issues.page.waiting, text: waiting, tone: "waiting" }];
}

function IssueBody({ issue, onChanged }: { issue: Issue; onChanged: () => void }) {
  const { me } = useSession();
  const support = profile.support;
  const hours = me.care_hours;
  const waiting = support.hint(
    support.within(hours.first_reply),
    support.hours(support.hour(hours.opens), support.hour(hours.closes)),
  );
  const photosFailed = new URLSearchParams(window.location.search).get("photos") === "failed";
  return (
    <div className={styles.page}>
      <IssueState state={issue.state} />
      <h1 className={styles.title}>{issueTitle(issue)}</h1>
      <p className={styles.raised}>{issues.raised(issue.reference, stamp(issue.raised_at))}</p>
      {issue.visit_id !== null && (
        <ListRows>
          <ListRow icon={CLIENT_ICONS.calendar} title={issues.page.theVisit} to={`/visits/${issue.visit_id}`} chevron />
        </ListRows>
      )}
      {photosFailed && (
        <p className={styles.problem} role="alert">
          {issues.raise.photoFailed}
        </p>
      )}
      <section aria-labelledby="log">
        <h2 className={styles.section} id="log">
          {issues.page.log}
        </h2>
        <Timeline items={logOf(issue, waiting)} />
      </section>
      {issue.reference !== null && <IssueActions issue={issue} reference={issue.reference} onChanged={onChanged} />}
    </div>
  );
}

export function IssueScreen({ id }: { id: string }) {
  const [loaded, retry] = useLoad(api.problems);
  const found = (log: readonly Issue[]) => log.find((issue) => issue.reference === id || issue.id === id);
  const title = loaded.state === "loaded" ? (found(loaded.value.issues)?.reference ?? titles.issue) : titles.issue;
  return (
    <Shell header={{ kind: "back", title, to: "/visits/issues", label: profile.back }} tab={null}>
      {whenLoaded(loaded, {
        loading: <Loading />,
        failed: <PageFailed onRetry={retry} />,
        loaded: ({ issues: log }) => {
          const issue = found(log);
          return issue === undefined ? (
            <p className={styles.none}>{issues.page.notFound}</p>
          ) : (
            <IssueBody issue={issue} onChanged={retry} />
          );
        },
      })}
    </Shell>
  );
}
